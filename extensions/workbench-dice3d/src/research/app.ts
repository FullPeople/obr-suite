import {url,now,type Catalog,type ThemeID,type Roll} from '../types';
import {materialCatalog,STYLE_CHOICES,presentationTheme} from '../material-styles';
import {DiceRenderer} from '../renderer';
import {RollAudioMixer} from '../audio-mixer';
import {parseFormula,evaluateFormula,type FormulaRow} from './formula';
import {LocalPhysics,combineWaves} from './physical';
import {formulaCue,FormulaShow,dimDiscarded} from './presentation';
import {appendRuleHops,type RuleTimeline,type PhysicalEntry} from './rule-timeline';
import {ClampVortices} from './clamp-vortex';
import {RuleFaceHighlight} from './rule-face-highlight';
import './research.css';

// Never mounts OBR, Controller, BroadcastChannel or any remote identity. Not a production entry.
if(!['127.0.0.1','localhost','[::1]'].includes(location.hostname))throw Error('公式研究室只允许在本机打开');
const stage=document.getElementById('research-stage')!,panel=document.getElementById('research-panel')!,caption=document.getElementById('stage-caption')!;
const examples=[
  ['加值飞入','2d6+5','先汇集每颗骰子，再让 +5 从名字下飞入。'],
  ['混合骰池','2d6+1d4+3','不同骰型同时投出，在同一物理世界互相碰撞，统一汇集。'],
  ['优势','adv(1d20)+5','投两组取高；败选骰变暗，只有胜选参与汇集。'],
  ['劣势','dis(1d20)+2','投两组取低；选择发生在点数落定后。'],
  ['精灵之准','adv(1d20,2)+4','额外两组，三选一；仅演示三选一公式，不替你判断规则适用条件。'],
  ['最低保底','max(1d20,10)+3','低于保底时：向外漩涡、上扬音效、物理起跳翻到原有的 10 面，再汇集；不换刻字。'],
  ['最高封顶','min(1d20,15)','高于封顶时：向内漩涡、下行音效、物理起跳翻到原有的 15 面，再汇集；不换刻字。'],
  ['低点重投','resetmin(2d6,2)','≤2 的骰子真实再投一次；新骰即使仍低也不继续重投。'],
  ['爆炸追加','burst(4d6)','满值才追加真实骰子；未出现满值就不演出假爆炸。'],
  ['同值共鸣','same(4d6)','相同结果连接、呼应；不改变任何点数。'],
  ['三次独立','repeat(3,1d20+5)','三次一起出骰、各算各的；每条的 +5 都最后飞入。'],
  ['倍率收尾','5d6*3','先汇集原始点数，再让 ×3 飞入执行倍率。'],
  ['重击伤害','4d6+3','示范原 2d6 的骰子数量翻倍，加值只加一次。'],
];
panel.innerHTML=`<header><span class="eyebrow">FORMULA / EFFECT STUDIES</span><h2>骰子演出研究室</h2><p>单机可交互原型 · 不影响线上插件</p></header>
  <form id="formula-form"><label class="input-label" for="formula">公式</label><input id="formula" value="adv(1d20)+5" maxlength="240" autocomplete="off" spellcheck="false">
    <div class="appearance"><label>玩家名字<input id="player-name" value="旅人" maxlength="32"></label><label>玩家色<input id="player-color" type="color" value="#527cf2"></label></div>
    <label class="input-label" for="material">材质</label><select id="material">${STYLE_CHOICES.map(s=>`<option value="${s.id}" ${s.style==='sketch'?'selected':''}>${s.name}</option>`).join('')}</select>
    <div class="actions"><button id="submit" type="submit" disabled>准备中…</button><button id="replay" type="button" disabled>重播本次</button><button id="clear" type="button">清屏</button></div></form>
  <p id="status" role="status">加载中…</p><div id="research-error" role="alert" hidden></div>
  <section class="study-section"><h3>选一段演出</h3><div class="presets">${examples.map((e,i)=>`<button data-example="${i}" title="${e[1]}">${e[0]}</button>`).join('')}</div><p id="example-note">${examples[2][2]}</p></section>
  <section class="study-section"><h3>本次记录 <span>骰子到账才填入数字</span></h3><div id="history"><div class="empty-history">还没有投掷。选择示例，或直接输入公式。</div></div></section>
  <details><summary>研究范围与边界</summary><p>支持六种实体骰、加减乘、优势/劣势、保底/封顶、单次重投、连锁追加、同值和最外层 repeat。d100 双骰与自由文字混排留待下一轮。</p><p>混合骰池、优势/劣势、repeat 等同一轮的骰子一起出手，在同一 Jolt 世界真实碰撞；只有依赖前一轮结果的重投/爆炸追加才后续入场。同一轮触发的多颗追加也一起投。后续批次撞上前批的真实落点，不改写旧结果。</p><p>上限：40 枚实体骰、8 轮预测、repeat 5 次、每条爆炸链最多 5 次。超过明确报错，不截断成一个伪装完整的结果。自然 1/20 不换图，仍有额外冲击。</p></details>`;
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const button=get<HTMLButtonElement>('submit'),replay=get<HTMLButtonElement>('replay'),status=get('status'),history=get('history');
let renderer:DiceRenderer,physics:LocalPhysics,catalog:Catalog,busy=false;
let saved:(PhysicalEntry&{row:FormulaRow;timeline:RuleTimeline})[]=[];
const events:{event:string;detail:any}[]=[];
const sound=new RollAudioMixer((event,detail)=>{events.push({event,detail});if(events.length>300)events.splice(0,100);if(event==='error')fail(Error(String((detail as any)?.message||detail)))});
function fail(error:unknown){const text=error instanceof Error?error.message:String(error);get('research-error').hidden=false;get('research-error').textContent=text;status.textContent='未完成：请查看原因';caption.textContent='本次没有生成完整结果';}
function paint(){
  renderer.clear();history.replaceChildren();const at=now()+70;
  const items=saved.map(entry=>({...entry,cue:formulaCue(entry.roll,entry.ids,entry.row,renderer.projection,presentationTheme(catalog.themes[entry.roll.request.theme],entry.roll.request.bodyColor))}));
  const exit=Math.max(...items.map(e=>e.offset+e.cue.diceExit));
  for(const item of items){
    // Keep all physical witnesses until the final show has ended; later tracks were predicted
    // against them. The cue/name still fades on its own independent schedule.
    item.cue.diceExit=exit-item.offset;
    const card=document.createElement('article');card.className='history-card';const header=document.createElement('header');
    const name=document.createElement('b');name.textContent=item.roll.request.name;name.style.color=item.roll.request.bodyColor||'#9bd3bf';
    const stamp=document.createElement('time');stamp.textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});header.append(name,stamp);card.append(header);history.append(card);
    const show=new FormulaShow(stage,item.roll,item.ids,item.row,card,()=>renderer.projection,item.timeline),dim=dimDiscarded(item.ids,item.row,item.timeline.decisionAt),vortices=new ClampVortices(item.ids,item.timeline.clamps);
    const values=new RuleFaceHighlight(item.ids,item.timeline.clamps);
    const soundGroups=new Map<string,{t:number;kind:'max'|'min';pan:number}>();
    for(const effect of item.timeline.clamps)soundGroups.set(effect.kind+':'+effect.start,{t:effect.start,kind:effect.kind,pan:0});
    renderer.add(item.roll,at+item.offset*1000,{cue:item.cue,show,births:item.births,ruleSounds:[...soundGroups.values()].sort((a,b)=>a.t-b.t),
      onPrepare:meshes=>values.prepare(meshes),onFrame:(age,meshes)=>{dim(age,meshes);values.draw(age);vortices.draw(age,meshes);},onDispose:()=>{vortices.dispose();values.dispose();}});
  }
  caption.textContent='投掷 → 规则判断 → 数字汇集 → 加值 / 倍率';
  status.textContent=`已提交 ${items.length} 条独立结果 · 物理 ${Math.round(physics.waves.reduce((n,w)=>n+w.roll.physicsMs,0)+physics.hops.reduce((n,h)=>n+h.hop.physicsMs,0))} ms`;
}
async function run(expression?:string){
  if(busy||!renderer)return;
  if(expression!==undefined)get<HTMLInputElement>('formula').value=expression;
  busy=true;button.disabled=true;replay.disabled=true;get<HTMLButtonElement>('clear').disabled=true;get('research-error').hidden=true;
  try{
    const ast=parseFormula(get<HTMLInputElement>('formula').value);
    await sound.resume();renderer.clear();physics.clear();saved=[];status.textContent='同一轮骰子一起进行真实预测…';caption.textContent='正在计算真实落地结果，不预设点数';
    const theme=get<HTMLSelectElement>('material').value as ThemeID,color=get<HTMLInputElement>('player-color').value,name=get<HTMLInputElement>('player-name').value.trim()||'旅人';
    const rows=await evaluateFormula(ast,groups=>{status.textContent=`第 ${physics.waves.length+1} 轮 · ${groups.reduce((n,g)=>n+g.count,0)} 颗同时预测`;return physics.rollBatch(groups,theme,color,name)});
    const hops=await physics.prepareClamps(rows);
    saved=rows.map(row=>appendRuleHops({row,...combineWaves(physics.waves,rows.length>1?`${name} · 第 ${row.index+1} 次`:name,new Set(row.dice.map(d=>d.id)))},hops));
    paint();replay.disabled=false;
  }catch(error){renderer.clear();physics.clear();saved=[];fail(error)}
  finally{busy=false;button.disabled=false;button.textContent='投掷';get<HTMLButtonElement>('clear').disabled=false;}
}
get<HTMLFormElement>('formula-form').onsubmit=e=>{e.preventDefault();void run()};
replay.onclick=()=>{if(saved.length){void sound.resume();paint();status.textContent='重播同一条轨迹与结果，没有重新掷骰';}};
get('clear').onclick=()=>{renderer?.clear();caption.textContent='已清屏 · 可以重播或换一个公式'};
for(const element of panel.querySelectorAll<HTMLButtonElement>('[data-example]'))element.onclick=()=>{const example=examples[Number(element.dataset.example)];get<HTMLInputElement>('formula').value=example[1];get('example-note').textContent=example[2];panel.querySelectorAll('[data-example]').forEach(b=>b.classList.toggle('selected',b===element));};
try{
  const requestedMaterial=new URLSearchParams(location.search).get('material');
  if(requestedMaterial){
    if(!STYLE_CHOICES.some(s=>s.id===requestedMaterial))throw Error('未知材质: '+requestedMaterial);
    get<HTMLSelectElement>('material').value=requestedMaterial;
  }
  const response=await fetch(url('assets/catalog.json'));if(!response.ok)throw Error('读取锁定素材失败');catalog=materialCatalog(await response.json());
  const font=new FontFace('CinzelVariable',`url(${url('assets/fonts/Cinzel-Variable.ttf')})`,{weight:'400 900'});await font.load();document.fonts.add(font);
  renderer=new DiceRenderer(stage,catalog,(event,detail)=>{events.push({event,detail});if(events.length>300)events.splice(0,100);
    if(event==='render-queued'){sound.prepare(detail.roll,detail.theme,detail.audio);void sound.release(detail.roll,detail.start).catch(fail)}
    if(event==='render-complete'||event==='render-cancelled')sound.stop(detail.roll);
    if(event==='render-complete'){status.textContent='演出结束 · 可重播同一结果，或尝试下一条公式';caption.textContent='结果已记录 · 重播不会重新掷骰';}
    if(event==='error')fail(Error(detail.message));
  });
  physics=new LocalPhysics(catalog,()=>({w:stage.clientWidth,h:stage.clientHeight}));
  await Promise.all([renderer.init(),physics.warm(),sound.warmup()]);button.disabled=false;button.textContent='投掷';status.textContent='准备就绪';caption.textContent='选择公式，然后投掷';
  (window as any).__formulaLab={renderer,physics,run,events,sound,get saved(){return saved},get busy(){return busy}};
}catch(error){fail(error)}
