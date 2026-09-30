import OBR from '@owlbear-rodeo/sdk';
import {BUILD,CHANNEL,now,url,type Catalog,type ThemeID} from './types';
import type {AudioPlan} from './renderer';
import './style.css';
import {STYLE_CHOICES} from './material-styles';
import {VISIBILITY} from './hidden-roll';
import {resultCard} from './result-record';
import type {ResultRecord} from './controller';
const kb=(n:number)=>`${((n||0)/1024).toFixed(1)} KB`;
const fixed=(n:number,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
export function mountPanel(container:HTMLElement,client:string,preview=false){
  const bus=new BroadcastChannel(`${CHANNEL}:local:${client}`);
  // Sound remains in the permanent same-origin overlay after this popover is destroyed.
  const storedVolume=Number(localStorage.getItem('dice-lab.volume')??'100');

  container.innerHTML=`<header><div><span class="eyebrow">DESKTOP DICE / WEB LAB</span><h1>三维骰子实验室</h1></div><span class="version">${BUILD}</span></header>
    <div class="connection"><i id="ready-dot"></i><span id="connection-text">正在准备模型和物理…</span></div>
    <section class="controls"><div class="row"><label>骰型<select id="kind"><option value="mixed">七骰混合</option><option value="d20">D20</option><option value="d6">D6</option><option value="d4">D4</option><option value="d8">D8</option><option value="d10">D10</option><option value="d12">D12</option><option value="d_percentile">D% · 十位骰</option></select></label><label>材质<select id="theme">${STYLE_CHOICES.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></label></div>
    <div class="count-row"><label>数量 <input id="count" type="number" min="1" max="100" value="7"></label><div class="presets">${[1,7,20,50,100].map(n=>`<button data-count="${n}">${n}</button>`).join('')}</div></div>
    <div class="count-row"><label>加值 <input id="modifier" type="number" step="1" min="-999999" max="999999" value="0" aria-label="投掷加值"></label><span class="hint">正负均可 · 骰子汇集后最后飞入</span></div>
    <div class="row"><label>结果可见范围<select id="visibility">${VISIBILITY.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label></div>
    <p class="hint">无权限者只看问号骰，不显示结果气泡。暗骰结算后可在下方记录中公开。主持人指枭熊 GM 角色。</p>
    <p class="player-color"><i id="body-color-swatch" hidden></i><span id="body-color-note">正在读取房间玩家颜色…</span></p>
    <div class="row buttons"><button id="roll" class="primary" disabled>投掷并同步</button><button id="stress" disabled>连续 10 轮</button><button id="clear">清屏</button></div>
    <p id="work" role="status" hidden></p>
    <p class="hint">每次提交独立；大量骰子自动拉远视野，场地满时排队。清屏只影响本端。</p>
    </section>
    <section class="lab-history"><div class="section-title">投掷记录 <span>最近 100 条</span></div><div id="roll-history"></div></section>
    <section class="stats"><div><span>帧率</span><strong id="fps">—</strong><small>FPS</small></div><div><span>慢帧 p95</span><strong id="p95">—</strong><small>ms</small></div><div><span>当前骰子</span><strong id="active">0</strong><small>枚</small></div><div><span>物理准备</span><strong id="physics">—</strong><small>ms</small></div></section>
    <section class="detail-grid"><span>发送 / 接收</span><b id="traffic">0 / 0 KB</b><span>消息 / 绘制调用</span><b id="calls">0 / 0</b><span>完成 / 排队 / 失败</span><b id="counts">0 / 0 / 0</b><span>最大卡顿 / 长任务</span><b id="long">—</b><span>最近开播迟到</span><b id="late">—</b><span>最近轨迹</span><b id="hash">—</b></section>
    <section class="peers"><div class="section-title">联机实验端 <span id="peer-count">1</span></div><div id="peer-list"></div></section>
    <div id="error" role="alert" hidden></div>
    <footer><button id="sound">启用声音</button><label>音量<input id="volume" type="range" min="0" max="100" value="100"><span id="volume-value">100%</span></label><label>绘制精度<select id="quality"><option value="1">1×</option><option value="1.5" selected>1.5×</option><option value="2">2×</option></select></label><button id="reset">清空统计</button><button id="export">导出报告</button></footer>
    <details><summary>最近事件 / 测试说明</summary><p>结果来自 Jolt 的真实落稳面。其他端回放同一份校验后的运动轨迹。${preview?'当前是独立预览，同浏览器多标签通信不等于真实枭熊联机验收。':'请让所有玩家在同一个枭熊房间启用此插件；每端先等绿点就绪。'} 支持加密暗骰与结算后公开；权限在投掷时固定，刷新暂不恢复旧记录。暂不支持房间 DND 公式。D% 按十位骰单独测试。</p><pre id="log"></pre></details>`;
  const get=<T extends HTMLElement>(id:string)=>container.querySelector<T>(`#${id}`)!;
  const command=(action:string,extra:any={})=>bus.postMessage({type:'command',action,...extra});
  const options=()=>({kind:get<HTMLSelectElement>('kind').value,theme:get<HTMLSelectElement>('theme').value,count:Number(get<HTMLInputElement>('count').value),modifier:Number(get<HTMLInputElement>('modifier').value),visibility:get<HTMLSelectElement>('visibility').value});
  // Opening the context inside the click is what makes the browser allow playback at all.
  const arm=()=>bus.postMessage({type:'audio-command',action:'unlock'});
  get('sound').onclick=arm;
  get('roll').onclick=()=>{arm();command('roll',{options:options()})};
  get('stress').onclick=()=>{arm();command('stress',{options:options()})};
  get('clear').onclick=()=>command('clear');
  const volume=get<HTMLInputElement>('volume');
  volume.value=String(Math.round((Number.isFinite(storedVolume)?storedVolume:100)));
  get('volume-value').textContent=volume.value+'%';
  volume.oninput=()=>{bus.postMessage({type:'audio-command',action:'volume',value:Number(volume.value)/100});get('volume-value').textContent=volume.value+'%';localStorage.setItem('dice-lab.volume',volume.value)};
  get('reset').onclick=()=>command('reset-metrics');get('export').onclick=()=>command('export');get<HTMLSelectElement>('quality').onchange=e=>command('quality',{value:Number((e.target as HTMLSelectElement).value)});
  for(const b of container.querySelectorAll<HTMLButtonElement>('[data-count]'))b.onclick=()=>{get<HTMLInputElement>('count').value=b.dataset.count!};
  const log:string[]=[];
  bus.onmessage=e=>{const p=e.data;
    if(p.type==='history'){get('roll-history').replaceChildren(...(p.records as ResultRecord[]).slice().reverse().map(r=>resultCard(r,id=>command('reveal',{id}))));return}
    if(p.type==='audio-state'){get('sound').textContent=p.state==='running'?'声音已启用':'启用声音';return}
    if(p.type==='state'){
      const s=p.state,m=s.metrics;
      get('body-color-swatch').hidden=!s.color;get('body-color-swatch').style.backgroundColor=s.color||'';
      get('body-color-note').textContent=s.color?'骰子主色跟随房间玩家颜色；皮肤保留材质质感。':'独立预览：使用皮肤原色。';
      const phase=!s.overlay?'正在准备三维模型与皮肤…':(!s.physics?'正在加载物理引擎…':'启动已停止，请重新加载测试插件');
      get('ready-dot').classList.toggle('ready',s.ready);get('connection-text').textContent=s.ready?`${s.mode} · ${s.name}`:phase;
      get<HTMLButtonElement>('roll').disabled=!s.ready;get<HTMLButtonElement>('stress').disabled=!s.ready;get('stress').textContent=s.stress?'停止连投':'连续 10 轮';
      get('work').hidden=!s.work;get('work').textContent=s.work;
      get('fps').textContent=m.fps?fixed(m.fps,0):'—';get('p95').textContent=m.p95?fixed(m.p95):'—';get('active').textContent=String(m.dice||0);
      get('traffic').textContent=`${kb(s.bytesSent)} / ${kb(s.bytesReceived)}`;get('calls').textContent=`${s.packetsSent+s.packetsReceived} / ${m.drawCalls||0}`;
      get('counts').textContent=`${s.completed} / ${s.queued+(s.busy?1:0)} / ${s.failures}`;get('long').textContent=`${fixed(m.maxFrame)} ms / ${m.longTasks||0}`;
      get('peer-count').textContent=String(s.peers.length+1);get('peer-list').replaceChildren();
      for(const peer of s.peers){const row=document.createElement('div');row.className='peer';const name=document.createElement('span');name.textContent=peer.name;const status=document.createElement('span');status.textContent=peer.ready?`${peer.rtt<0?'测时中':fixed(peer.rtt,0)+' ms'}`:'加载中';row.append(name,status);get('peer-list').appendChild(row)}
      if(!s.peers.length)get('peer-list').textContent=preview?'可在另一标签打开同一预览地址测试传输。':'等待其他已启用本插件的玩家…';
      get('error').hidden=!s.error;get('error').textContent=s.error;
      (window as any).__diceLabState=s;
    }else if(p.type==='log'){
      log.push(`${new Date().toLocaleTimeString()} ${p.event} ${JSON.stringify(p.detail)}`);if(log.length>35)log.shift();get('log').textContent=log.join('\n');
      if(p.event==='trajectory-ready'){get('physics').textContent=fixed(p.detail.physicsMs,0);get('hash').textContent=p.detail.hash.slice(0,12);get('hash').title=p.detail.hash}
      if(p.event==='trajectory-verified'){get('hash').textContent=p.detail.hash.slice(0,12);get('hash').title=p.detail.hash}
      if(p.event==='render-release')get('late').textContent=`${fixed(p.detail.lateMs)} ms`;
    }else if(p.type==='export'){
      const blob=new Blob([JSON.stringify(p.data,null,2)],{type:'application/json'}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=`dice-lab-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
    }
  };
  bus.postMessage({type:'panel-ready'});
}
if(location.pathname.endsWith('/index.html')||location.pathname.endsWith('/dice-lab-dev/'))OBR.onReady(async()=>mountPanel(document.getElementById('panel')!,await OBR.player.getConnectionId()));
