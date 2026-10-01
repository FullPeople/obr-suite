import {DiceRenderer} from './renderer';
import {mountAudioHost} from './audio-host';
import {CHANNEL,url,errorText,type Roll} from './types';
import './style.css';
import {unmaskRoll} from './hidden-roll';
import {formulaCue,FormulaShow,dimDiscarded} from './research/presentation';
import {ClampVortices} from './research/clamp-vortex';
import {RuleFaceHighlight} from './research/rule-face-highlight';
import {presentationTheme} from './material-styles';
import {buildCue} from './cue';
import './research/research.css';
import './suite-overlay.css';
import {DiceAssets} from './asset-loading';
import {diceCatalog} from './asset-catalog';
export async function mountOverlay(container:HTMLElement,client:string){
  const bus=new BroadcastChannel(`${CHANNEL}:local:${client}`),assets=new DiceAssets(progress=>bus.postMessage({type:'load-progress',progress}));
  const catalog=diceCatalog(),parents=new Map<string,{id:string;pending:Set<string>;failed?:boolean}>();
  const audioPaths=Object.values(catalog.themes).flatMap(t=>[...Object.values(t.audio.impacts).flatMap(Object.values),t.audio.rolling,t.audio.tension,t.audio.natural_1,t.audio.natural_20]);
  assets.plan(['assets/fonts/Cinzel-Variable.ttf',...Object.values(catalog.dice).map(d=>d.model),...Object.values(catalog.themes).flatMap(t=>Object.values(t.masks)),...audioPaths]);
  const audio=mountAudioHost(client,assets,catalog);(window as any).__diceLabAudio=audio;
  // The result numbers use the same Cinzel variable font the native ships; canvas needs it loaded.
  const face=new FontFace('CinzelVariable',await assets.bytes('assets/fonts/Cinzel-Variable.ttf'),{weight:'400 900'});
  await face.load();document.fonts.add(face);
  let rendererDetail:any,anchors:Record<string,{x:number;y:number}>={};
  const tracking=new Map<string,string>(),labels=document.createElement('div');labels.className='token-result-layer';container.append(labels);
  const track=()=>bus.postMessage({type:'track-tokens',ids:[...new Set(tracking.values())]});
  const labelNodes=new Map<string,HTMLDivElement>();
  const drawLabels=(groups:any[])=>{const seen=new Set<string>();for(const group of groups)if(group.visible)for(const row of group.rows){
    const point=anchors[row.itemId];if(!point)continue;const key=group.id+'\0'+row.itemId;seen.add(key);let el=labelNodes.get(key);
    if(!el){el=document.createElement('div');el.className='token-result';el.dataset.group=group.id;el.append(document.createElement('strong'),document.createElement('span'));labelNodes.set(key,el);labels.append(el);}
    el.style.left=point.x+'px';el.style.top=point.y+'px';el.style.color=/^#[0-9a-f]{6}$/i.test(row.color)?row.color:'#fff';el.style.opacity=row.hidden?'.7':'1';const color=el.style.color.match(/\d+/g)?.map(Number)||[255,255,255];el.style.setProperty('--result-outline',color[0]*.2126+color[1]*.7152+color[2]*.0722>140?'#16181c':'#fff');
    const total=el.firstElementChild!,caption=el.lastElementChild!,value=String(row.total);if(total.textContent!==value)total.textContent=value;if(caption.textContent!==row.text)caption.textContent=row.text;
  }for(const [key,el]of labelNodes)if(!seen.has(key)){el.remove();labelNodes.delete(key);}};

  const renderer=new DiceRenderer(container,catalog,(event,detail)=>{
    if(event==='renderer-ready'){rendererDetail=detail;return;}
    if(event==='render-complete'||event==='render-cancelled'){tracking.delete(detail.roll);track();}
    const parent=parents.get(detail?.roll);
    if(parent&&(event==='render-complete'||event==='render-cancelled')){parent.failed ||= !!detail.failed;parent.pending.delete(detail.roll);bus.postMessage({type:'renderer-event',event:'audio-finished-child',detail});if(!parent.pending.size){bus.postMessage({type:'renderer-event',event:parent.failed?'render-cancelled':event,detail:{...detail,roll:parent.id,failed:parent.failed}});for(const [id,value] of parents)if(value===parent)parents.delete(id);}return;}
    bus.postMessage(event==='renderer-ready'?{type:'overlay-ready',detail}:{type:'renderer-event',event,detail});
  },assets);
  const prepared=new Map<string,Roll>(),archive=new Map<string,Roll>();
  // Full Suite owns the unified activity/history surface. Do not add a second Lab history.
  bus.onmessage=e=>{const p=e.data;try{
    if(p.type==='token-results'){anchors=p.anchors||{};drawLabels(p.groups||[]);}
    else if(p.type==='prepare'){prepared.set(p.roll.request.id,p.roll);archive.set(p.roll.request.id,p.roll);while(archive.size>20||[...archive.values()].reduce((n,r)=>n+r.poses.byteLength,0)>64000000)archive.delete(archive.keys().next().value!);bus.postMessage({type:'prepared',id:p.roll.request.id})}
    else if(p.type==='suite-unmask-archive'){const roll=archive.get(p.id);if(roll?.masked)archive.set(p.id,unmaskRoll(roll,p.details,catalog));}
    else if(p.type==='suite-replay'){for(const id of p.ids){const roll=archive.get(id);if(!roll)throw Error('该 3D 轨迹已释放（最近 20 条 / 64 MB 上限），不能以重掷代替回放');bus.onmessage!({data:{type:'prepare',roll}} as MessageEvent);bus.onmessage!({data:{type:'start',id,at:performance.timeOrigin+performance.now()+70}} as MessageEvent);}}
    else if(p.type==='start'){const roll=prepared.get(p.id);if(!roll)throw Error('开播时缺少已验证轨迹');
      const f=roll.formulaData;
      if(!f||roll.masked)renderer.add(roll,p.at,undefined);
      else{
        const parent={id:p.id,pending:new Set<string>()},theme=presentationTheme(catalog.themes[roll.request.theme],roll.request.bodyColor),life=buildCue(roll,renderer.projection,theme).diceExit;
        for(const row of f.rows){const included=new Set(row.dice.map(d=>d.id)),indices=f.ids.map((id,i)=>included.has(id)?i:-1).filter(i=>i>=0),ids=indices.map(i=>f.ids[i]),n=indices.length,poses=new Float32Array(roll.frames*n*7),tags=new Map(indices.map((source,i)=>[source+1,i+1]));
          for(let frame=0;frame<roll.frames;frame++)for(const [i,source] of indices.entries())poses.set(roll.poses.subarray((frame*roll.kinds.length+source)*7,(frame*roll.kinds.length+source+1)*7),(frame*n+i)*7);
          const child={...roll,request:{...roll.request,id:`${p.id}:r${row.index}`,count:n,name:roll.request.name},kinds:indices.map(i=>roll.kinds[i]),results:indices.map(i=>roll.results[i]),poses,contacts:roll.contacts.filter(c=>tags.has(c.a)).map(c=>({...c,a:tags.get(c.a)!,b:tags.get(c.b)??0}))};child.collisions=child.contacts.length;
          const fullRow={...row,compute:()=>row.total},cue=formulaCue(child,ids,fullRow,renderer.projection,theme);cue.diceExit=Math.max(life,cue.diceExit);
          const timeline={...f.timeline,births:indices.map(i=>f.births[i]),clamps:f.timeline.clamps.filter(c=>included.has(c.id))},dim=dimDiscarded(ids,fullRow,timeline.decisionAt),vortex=new ClampVortices(ids,timeline.clamps),highlight=new RuleFaceHighlight(ids,timeline.clamps),card=document.createElement('article');
          const show=new FormulaShow(container,child,ids,fullRow,card,()=>renderer.projection,timeline);if(f.context?.itemId){const item=f.context.itemId;tracking.set(child.request.id,item);show.setAnchor(()=>anchors[item],f.context.label||row.formula);track();}
          const rules=new Map<string,{t:number;kind:'max'|'min';pan:number}>();for(const c of timeline.clamps)rules.set(c.kind+':'+c.start,{t:c.start,kind:c.kind,pan:0});
          parent.pending.add(child.request.id);parents.set(child.request.id,parent);
          renderer.add(child,p.at,{cue,show,births:timeline.births,ruleSounds:[...rules.values()],onPrepare:meshes=>highlight.prepare(meshes),onFrame:(age,meshes)=>{dim(age,meshes);highlight.draw(age);vortex.draw(age,meshes);},onDispose:()=>{vortex.dispose();highlight.dispose();}});
        }
      }prepared.delete(p.id)}
    else if(p.type==='discard')prepared.delete(p.id);
    else if(p.type==='clear')renderer.clear();
    else if(p.type==='quality')renderer.quality(p.value);
    else if(p.type==='reset-metrics')renderer.resetMetrics();
    else if(p.type==='result-bubble'&&p.highlight)bus.postMessage({type:'suite-reveal-highlight',id:p.record.id});
  }catch(error){bus.postMessage({type:'renderer-event',event:'error',detail:{message:errorText(error)}})}};
  assets.stage('加载模型、数字贴图和音效');
  await Promise.all([audio.warmup(),renderer.init()]);assets.stage('首次渲染完成');
  bus.postMessage({type:'overlay-ready',detail:rendererDetail});return renderer;
}
if(location.pathname.endsWith('/overlay.html')){
  document.body.classList.add('overlay');
  const client=new URLSearchParams(location.search).get('client');
  if(!client)throw Error('缺少本地客户端身份');
  void mountOverlay(document.body,client).catch(error=>{new BroadcastChannel(`${CHANNEL}:local:${client}`).postMessage({type:'renderer-event',event:'error',detail:{message:errorText(error)}})});
}
