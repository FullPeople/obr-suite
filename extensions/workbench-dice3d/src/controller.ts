import {canSeeDiceHistory,DICE_HISTORY_LIMIT,type DiceHistoryVisibility} from '../../../src/modules/dice/history-policy';
import {Assembly,split,hash,sizeOf,encodeRoll,decodeRoll,MAX_MESSAGE_BYTES} from './wire.mjs';
import {BUILD,CHANNEL,now,url,errorText,type Catalog,type Peer,type Request,type Roll,type EventRecord,type Viewport,KINDS} from './types';
import {buildCue} from './cue';
import {makeProjection} from './native';
import {floorBudget} from './physics-capacity';
import {normalizePlayerColor,validBodyColor} from './player-color.mjs';
import {validModifier} from './modifier.mjs';
import {audienceFor,hiddenRequest,maskRoll,unmaskRoll,validVisibility,validateDetails,type SecretDetails,type Role} from './hidden-roll';
import {SecretKeys,secretCommitment} from './secret-keys';
import {dieTotalValue} from './cue';
import {validateRecipe} from './suite-formula';
import {formulaCue} from './research/presentation';
import {packReveal,unpackReveal} from './suite-reveal';
import {diceCatalog} from './asset-catalog';
import {splitGroupRoll} from './group-batch';
export interface Transport {id:string;name:string;color?:string;role?:Role;resolveRole?:(id:string)=>Promise<Role|undefined>;mode:string;send:(data:any)=>Promise<void>;sendTimed?:(data:any,beforeDispatch:()=>void)=>Promise<void>;listen:(fn:(data:any,source:string)=>void)=>()=>void}
export interface ResultRecord{visibility?:DiceHistoryVisibility;id:string;source:string;name:string;color?:string;kinds:Roll['kinds'];results:number[];modifier:number;total:number;secret:boolean;revealed:boolean;complete:boolean;at:number;canReveal:boolean;formulaData?:Roll['formulaData']}
interface Reservation{request:Request;broker:string;at:number;members:string[]}
interface SecretArchive{request:Request;kinds:Roll['kinds'];commitment:string;details?:SecretDetails;complete:boolean;revealed:boolean}
interface Received {source:string;assembly:Assembly;at:number;retry:number;processing:boolean;prepared:boolean;start?:{hash:string;start:number}}
interface Outgoing {dispatching?:boolean;uploading:boolean;roll:Roll;chunks:string[];hash:string;bytes:number;wait:Set<string>;members:string[];at:number;started:boolean;retry:number;start?:number;acks:Set<string>;lastStartRetry:number;window:number;viewers:Set<string>;repairs?:Map<string,Set<number>>;repairing?:boolean}
export class Controller {
  readonly bus:BroadcastChannel;
  private worker=new Worker(new URL('./physics.worker.ts',import.meta.url),{type:'module'});
  private catalog!:Catalog;
  private peers=new Map<string,Peer>();
  private inbound=new Map<string,Received>();
  private outgoing=new Map<string,Outgoing>();
  private rolls=new Map<string,Roll>();
  private queue:Request[]=[];
  private pending?:Request;
  private pendingTimer=0;
  /** Last known dice-layer size; the native ground bounds come from the source client's screen. */
  private viewport:Viewport={w:1920,h:1080};
  private ready=false;
  private overlayReady=false;private physicsReady=false;private disabled=false;
  private events:EventRecord[]=[];
  private receipts:any[]=[];
  private probes=new Map<string,{to:string;t:number}>();
  private clocks=new Map<string,{at:number;rtt:number;offset:number}[]>();
  private started=new Map<string,{source:string;hash:string;at:number}>();
  private bytesSent=0;private bytesReceived=0;private packetsSent=0;private packetsReceived=0;
  private metrics:any={};private error='';private failures=0;private completed=0;private stress=0;
  private lastPresence=0;private lastState=0;private ticking=false;
  // Logical join order, not a cross-machine wall clock. A loading newcomer follows known members.
  private born=0;
  private requests=new Map<string,{request:Request;at:number;authority:string;status?:string}>();
  private accepted=new Map<string,number>();
  private wasAuthority=true;
  private retainedUntil=new Map<string,number>();
  private settledAt=new Map<string,number>();
  private heldRolls=new Map<string,Roll>();
  private waitingForSpace='';
  private readonly keys:SecretKeys;
  private readonly session=crypto.randomUUID();
  private inbox=Promise.resolve();
  private reservation?:Reservation;
  private reservations=new Map<string,Reservation>();
  private privateRunning=new Set<string>();
  private privateAudiences=new Map<string,string[]>();
  private secrets=new Map<string,SecretArchive>();
  private records=new Map<string,ResultRecord>();
  private interval:ReturnType<typeof setInterval>;
  private stopTransport:()=>void;
  private releasePhysics(id:string){this.retainedUntil.delete(id);this.settledAt.delete(id);this.heldRolls.delete(id);this.worker.postMessage({type:'release',id})}
  private viewerFinished(id:string,viewer:string){const out=this.outgoing.get(id);if(out){out.viewers.delete(viewer);if(!out.viewers.size){this.releasePhysics(id);
    void this.send({type:'retire',id}).catch(e=>this.fail('retire',e));this.next()}}}
  private retainUntilExit(roll:Roll,start:number){const cue=buildCue(roll,makeProjection(this.viewport.w,this.viewport.h),this.catalog.themes[roll.request.theme]);
    if(roll.formulaData&&!hiddenRequest(roll.request))for(const row of roll.formulaData.rows)cue.diceExit=Math.max(cue.diceExit,formulaCue(roll,roll.formulaData.ids,{...row,compute:()=>row.total},makeProjection(this.viewport.w,this.viewport.h),this.catalog.themes[roll.request.theme]).diceExit);
    const until=start+cue.diceExit*1000;this.retainedUntil.set(roll.request.id,until);this.settledAt.set(roll.request.id,start+roll.duration*1000);this.heldRolls.set(roll.request.id,roll);
    setTimeout(()=>{this.releasePhysics(roll.request.id);this.next()},Math.max(0,until-now()+40));}
  constructor(readonly transport:Transport){
    this.keys=new SecretKeys(transport.id);
    if(transport.color!==undefined)transport.color=normalizePlayerColor(transport.color);
    this.bus=new BroadcastChannel(`${CHANNEL}:local:${transport.id}`);
    this.bus.onmessage=e=>{void this.onLocal(e.data).catch(e=>this.fail('local-command',e))};
    this.stopTransport=transport.listen((p,s)=>{const receivedAt=now();this.inbox=this.inbox.then(()=>this.receive(p,s,receivedAt)).catch(e=>this.fail('network-receive',e))});
    this.worker.onerror=e=>{const pending=this.pending;this.disabled=true;this.pending=undefined;clearTimeout(this.pendingTimer);this.refreshReady();
      this.fail('physics-worker',e.message);if(pending&&hiddenRequest(pending)){this.cancelSecret(pending.id);void this.send({type:'secret-failed',id:pending.id,reason:'暗骰来源的物理计算器发生错误'}).catch(error=>this.fail('hidden-failure-notice',error))}this.next()};
    this.worker.onmessage=e=>{void this.onWorker(e.data).catch(e=>this.fail('physics-result',e))};
    this.interval=setInterval(()=>{if(this.ticking)return;this.ticking=true;void this.tick().catch(e=>this.fail('maintenance',e)).finally(()=>{this.ticking=false;})},500);
  }
  dispose(){clearInterval(this.interval);clearInterval(this.stress);clearTimeout(this.pendingTimer);this.stopTransport();this.worker.terminate();this.bus.close();this.disabled=true;}
  async init(){
    await this.keys.ready;
    this.catalog=diceCatalog();this.log('controller-ready',{mode:this.transport.mode,build:BUILD});
    // Pay the engine load here, behind the panel's "preparing" state, instead of on the first roll.
    this.worker.postMessage({type:'warmup',catalog:this.catalog,view:this.viewport});
    await this.send({type:'hello',ready:false,name:this.transport.name,born:this.born});this.state();
  }
  async setProfile(name:string,color?:string,role?:Role){if(!name.trim()||name.length>100)throw Error('玩家名字须为 1–100 字符');
    const normalized=color===undefined?undefined:normalizePlayerColor(color);
    if(name===this.transport.name&&normalized===this.transport.color&&(!role||role===this.transport.role))return;
    this.transport.name=name;this.transport.color=normalized;if(role)this.transport.role=role;this.state();this.sendRecords();
    await this.send({type:'hello',ready:this.ready,name});}
  private refreshReady(){
    const next=!this.disabled&&this.overlayReady&&this.physicsReady;
    if(next!==this.ready){this.ready=next;if(next)this.log('layer-ready',{});this.state();void this.send({type:'hello',ready:next,name:this.transport.name}).catch(e=>this.fail('presence-ready',e))}
  }
  log(event:string,detail:any){this.events.push({at:now(),event,detail});if(this.events.length>2500)this.events.splice(0,500);this.bus.postMessage({type:'log',event,detail});console.info(`[DiceLab] ${event}`,detail)}
  fail(stage:string,error:unknown){this.error=`${stage}: ${errorText(error)}`;this.failures++;this.log('failure',{stage,error:this.error});this.state()}
  state(){this.bus.postMessage({type:'state',state:{id:this.transport.id,name:this.transport.name,color:this.transport.color,mode:this.transport.mode,version:BUILD,ready:this.ready,overlay:this.overlayReady,physics:this.physicsReady&&!this.disabled,peers:[...this.peers.values()],queued:this.queue.length,busy:this.pending?.id||'',work:this.waitingForSpace?'桌面空间不足，保留当前骰子，等待演出结束后继续投掷':this.pending?'正在预测物理轨迹…':this.queue.length?'正在按提交顺序准备…':[...this.requests.values()].filter(r=>r.authority!==this.transport.id).map(r=>r.status||'已提交，等待房间计算…')[0]||'',bytesSent:this.bytesSent,bytesReceived:this.bytesReceived,packetsSent:this.packetsSent,packetsReceived:this.packetsReceived,metrics:this.metrics,error:this.error,failures:this.failures,completed:this.completed,receipts:this.receipts.slice(-30),stress:!!this.stress}})}
  private async send(data:any,stamp?:(packet:any)=>void){const p={v:1,build:BUILD,from:this.transport.id,...data};if(p.type==='hello'){await this.keys.ready;p.born=this.born;p.color=this.transport.color;p.role=this.transport.role;p.publicKey=this.keys.publicKey;p.session=this.session}let bytes=0;const beforeDispatch=()=>{stamp?.(p);bytes=sizeOf(p);if(bytes>MAX_MESSAGE_BYTES)throw Error(`消息超限 ${bytes}`);};if(this.transport.sendTimed)await this.transport.sendTimed(p,beforeDispatch);else{beforeDispatch();await this.transport.send(p);}this.bytesSent+=bytes;this.packetsSent++}
  private authority(){return [{id:this.transport.id,born:this.born,ready:this.ready},...[...this.peers.values()].filter(p=>now()-p.lastSeen<12000)]
    .filter(p=>p.ready).sort((a,b)=>a.born-b.born||a.id.localeCompare(b.id))[0]?.id||this.transport.id}
  private async ping(id:string){if(this.clocks.get(id)?.some(s=>now()-s.at<4000)||[...this.probes.values()].some(p=>p.to===id&&now()-p.t<2500))return;const nonce=crypto.randomUUID(),probe={to:id,t:now()};this.probes.set(nonce,probe);await this.send({type:'ping',to:id,nonce,t:probe.t},packet=>{packet.t=probe.t=now();})}
  private async onLocal(p:any){
    if(p?.type==='panel-ready'){this.state();this.sendRecords();return}
    if(p?.type==='overlay-ready'){
      if(p.detail?.view)this.viewport={w:p.detail.view.w,h:p.detail.view.h};
      this.overlayReady=true;this.log('renderer-ready',p.detail);this.refreshReady();await this.send({type:'hello',ready:this.ready,name:this.transport.name});this.state();return;
    }
    if(p?.type==='renderer-event'){
      const {event,detail}=p;
      if(event==='render-metrics')this.metrics=detail;
      else if(event==='viewport')this.viewport={w:detail.w,h:detail.h};
      else if(event==='error')this.fail('renderer',detail.message);
      else{
        this.log(event,detail);
        if(event==='render-context-lost'||event==='render-unavailable'){this.overlayReady=false;this.refreshReady();}
        if(event==='render-context-restored'){this.overlayReady=true;this.refreshReady();}
        if(event==='render-complete')this.completeRecord(detail.roll);
        if(event==='render-cancelled'&&!detail.failed)setTimeout(()=>this.completeRecord(detail.roll),Math.max(0,(this.retainedUntil.get(detail.roll)??now())-now()));
        // The persistent layer owns both the projection and per-roll audio. The panel only arms it.
        if(event==='render-queued'&&detail.audio)this.bus.postMessage({type:'audio-plan',roll:detail.roll,theme:detail.theme,plan:detail.audio,start:detail.start});
        if(event==='render-paused')this.bus.postMessage({type:'audio-pause',roll:detail.roll});
        if(event==='render-retimed')this.bus.postMessage({type:'audio-retime',roll:detail.roll,at:detail.start});
        if(event==='render-release')this.bus.postMessage({type:'audio-release',roll:detail.roll,at:detail.planned});
        if(event==='render-complete'||event==='render-cancelled'||event==='audio-finished-child')this.bus.postMessage({type:'audio-stop',roll:detail.roll});
        if(event==='render-release'||event==='render-settled'||event==='render-complete'||event==='render-cancelled'){
          const roll=this.rolls.get(detail.roll);if(roll){const receipt=hiddenRequest(roll.request)?{roll:detail.roll,hidden:true}:detail;await this.send({type:'receipt',to:roll.request.authority||roll.request.source,event,detail:receipt});this.recordReceipt(this.transport.id,event,receipt)}
          if(event==='render-complete'||event==='render-cancelled')this.viewerFinished(detail.roll,this.transport.id);
        }
        if(event==='render-complete'){this.completed++;this.rolls.delete(detail.roll);if((this.retainedUntil.get(detail.roll)||0)<=now())this.releasePhysics(detail.roll);this.next()}
        if(event==='render-cancelled'){this.rolls.delete(detail.roll);if((this.retainedUntil.get(detail.roll)||0)<=now())this.releasePhysics(detail.roll);this.next()}
      }
      this.state();return;
    }
    if(p?.type==='prepared'){
      const out=this.outgoing.get(p.id);if(out){out.wait.delete(this.transport.id);await this.maybeStart(out)}
      else {const inbound=this.inbound.get(p.id);if(inbound){inbound.prepared=true;await this.ping(inbound.source);await this.sendReady(p.id,inbound)}}
      return;
    }
    if(p?.type==='command'){
      if(p.action==='roll')await this.submit(p.options);
      else if(p.action==='reveal')await this.reveal(p.id);
      else if(p.action==='clear'){this.bus.postMessage({type:'clear'});this.log('local-clear',{});}
      else if(p.action==='quality')this.bus.postMessage({type:'quality',value:p.value});
      else if(p.action==='reset-metrics'){this.error='';this.failures=0;this.bytesSent=0;this.bytesReceived=0;this.packetsSent=0;this.packetsReceived=0;this.events=[];this.receipts=[];this.bus.postMessage({type:'reset-metrics'});this.state()}
      else if(p.action==='export')this.bus.postMessage({type:'export',data:{schema:'dice-lab.evidence.v1',build:BUILD,created:new Date().toISOString(),mode:this.transport.mode,userAgent:navigator.userAgent,viewport:{width:screen.width,height:screen.height,dpr:devicePixelRatio},events:this.events,receipts:this.receipts,metrics:this.metrics,bytesSent:this.bytesSent,bytesReceived:this.bytesReceived,failures:this.failures}});
      else if(p.action==='stress'){
        if(this.stress){clearInterval(this.stress);this.stress=0;this.log('stress-stopped',{})}
        else{let rounds=0;const options=p.options;await this.submit(options);rounds++;
          this.stress=setInterval(()=>{if(rounds>=10){clearInterval(this.stress);this.stress=0;this.state();return}void this.submit(options).then(()=>rounds++).catch(e=>{clearInterval(this.stress);this.stress=0;this.fail('stress',e)})},1500);this.log('stress-started',{rounds:10,intervalMs:1500,count:options.count});}
        this.state();
      }
    }
  }
  async submit(options:any):Promise<string>{
    if(!this.ready)throw Error('三维层尚未就绪');
    if(!validModifier(options?.modifier))throw Error('加值须为 -999999 到 999999 的整数');
    if(options?.visibility!==undefined&&!validVisibility(options.visibility))throw Error('非法可见范围');
    if(!options||!Number.isInteger(options.count)||options.count<1||options.count>100||(!KINDS.includes(options.kind)&&options.kind!=='mixed')||!this.catalog.themes[options.theme as keyof Catalog['themes']])throw Error('非法测试选项');
    if(this.queue.length>=10)throw Error('准备队列已满（10），请等待后再试');
    const seed=crypto.getRandomValues(new Uint32Array(1))[0];
    // Source identity and room colour come from the SDK transport, never popover options.
    // A copied colour string is immutable for this roll even if the player changes it while queued.
    const request:Request={id:options.id??crypto.randomUUID(),source:this.transport.id,name:this.transport.name,
      kind:options.kind,count:options.count,theme:options.theme,bodyColor:this.transport.color,modifier:options.modifier??0,visibility:options.visibility??'all',seed,recipe:options.recipe,groupSize:options.formulas?.length,formula:options.formula,formulas:options.formulas,contexts:options.contexts,preset:options.preset,context:options.context};
    if(typeof request.id!=='string'||request.id.length<1||request.id.length>80)throw Error('非法提交身份');validateRecipe(request);
    if(request.formulas){if(request.visibility!=='gm'||request.formulas.length!==request.contexts?.length)throw Error('群体需要私有物理预约');for(const [index,context]of request.contexts.entries()){if(!validVisibility(context.visibility))throw Error('无效群体可见范围');this.privateAudiences.set(`${request.id}.g${index}`,audienceFor(context.visibility,this.transport.id,[{id:this.transport.id,role:this.transport.role!},...[...this.peers.values()].filter(p=>p.ready&&p.role&&now()-p.lastSeen<12000).map(p=>({id:p.id,role:p.role!}))]));}}
    if(hiddenRequest(request)){
      if(!this.transport.role)throw Error('尚未取得枭熊玩家角色，不能创建暗骰');
      const broker=this.authority();request.authority=this.transport.id;
      this.privateAudiences.set(request.id,audienceFor(request.visibility!,this.transport.id,[{id:this.transport.id,role:this.transport.role},...[...this.peers.values()].filter(p=>p.ready&&p.role&&now()-p.lastSeen<12000).map(p=>({id:p.id,role:p.role!}))]));
      this.requests.set(request.id,{request,at:now(),authority:broker});
      const descriptor={...request,seed:0,modifier:0,formula:undefined,formulas:undefined,contexts:undefined,preset:undefined,context:undefined};
      this.log('hidden-submitted',{id:request.id,count:request.count,scope:request.visibility,broker});
      try{if(broker===this.transport.id)this.accept(descriptor);else await this.send({type:'secret-request',to:broker,request:descriptor})}
      catch(error){this.privateAudiences.delete(request.id);this.requests.delete(request.id);throw error}
      this.state();return request.id;
    }
    request.authority=this.authority();this.requests.set(request.id,{request,at:now(),authority:request.authority});
    this.log('roll-submitted',{id:request.id,count:request.count,kind:request.kind,seed,authority:request.authority});
    if(request.authority===this.transport.id)this.accept(request);
    else await this.send({type:'roll-request',to:request.authority,request});
    this.state();return request.id;
  }
  private accept(request:Request){
    if(this.accepted.has(request.id))return;
    if(this.queue.length>=10)throw Error('权威准备队列已满');
    this.accepted.set(request.id,now());this.queue.push(request);this.next();
  }
  private next(){
    const isAuthority=this.authority()===this.transport.id;
    if(!isAuthority){this.wasAuthority=false;return}
    if(!this.wasAuthority){this.worker.postMessage({type:'retain',rolls:[...this.heldRolls.values()],catalog:this.catalog});this.wasAuthority=true;this.log('authority-takeover',{retained:this.heldRolls.size})}
    if(this.disabled||this.pending||this.reservation||!this.queue.length)return;
    // Do not let a synchronous worker reply race a scheduled release, or erase a still-visible
    // incumbent to make capacity. Each request remains a distinct roll.
    if([...this.outgoing.values()].some(out=>out.dispatching||!out.started||(out.start||0)>now()))return;
    if(new Set([...this.heldRolls.values()].map(r=>r.request.batch?.id||r.request.id)).size>=8)return;
    const space=floorBudget(this.queue[0],[...this.heldRolls.values()],this.catalog,this.viewport);
    if(!space.allowed){if(this.waitingForSpace!==this.queue[0].id){this.waitingForSpace=this.queue[0].id;
      this.log('waiting-for-floor-space',{id:this.waitingForSpace,...space,reason:'保留当前骰子大小和场上碰撞，空间释放后投下一条'});this.state()}return}
    this.waitingForSpace='';
    if(hiddenRequest(this.queue[0])){
      const request=this.queue.shift()!;this.reservation={request,broker:this.transport.id,at:now(),members:[this.transport.id,...[...this.peers.values()].filter(p=>p.ready&&now()-p.lastSeen<12000).map(p=>p.id)]};
      this.reservations.set(request.id,this.reservation);
      void this.send({type:'secret-grant',request,members:this.reservation.members}).then(()=>this.beginSecret(request)).catch(e=>{this.cancelSecret(request.id);this.fail('hidden-reservation',e);void this.send({type:'secret-failed',id:request.id,reason:errorText(e)}).catch(error=>this.fail('hidden-failure-notice',error))});return;
    }
    this.pending=this.queue.shift()!;this.worker.postMessage({request:this.pending,catalog:this.catalog,view:this.viewport});
    // A product batch of 20 predicts in seconds; the web stress tiers predict 100 dice and need room.
    const budget=this.pending.count>20?180000:40000;
    this.pendingTimer=setTimeout(()=>{const id=this.pending?.id;this.fail('physics-timeout',`Worker ${budget/1000} 秒未返回 ${id}`);this.queue=[];this.worker.terminate();this.pending=undefined;this.disabled=true;this.refreshReady()},budget);
  }
  private async onWorker(data:any){
    if(data?.type==='load-progress'){this.bus.postMessage({...data,engine:true});return;}
    if(data?.type==='retained'){if(data.error){this.disabled=true;this.fail('authority-takeover',data.error);this.refreshReady()}else this.log('authority-retained',{count:data.count});return}
    if(data?.type==='warm'){
      if(data.error){this.disabled=true;this.fail('physics-warmup',data.error);this.refreshReady();return}
      this.physicsReady=true;this.log('physics-warm',{engineMs:Math.round(data.engineMs),totalMs:Math.round(data.totalMs)});this.refreshReady();return;
    }
    if(!this.pending||this.pending.id!==data.id)throw Error('Unexpected physics response');
    const pending=this.pending;clearTimeout(this.pendingTimer);this.pending=undefined;
    try{
      if(data.error)throw Error(data.error);
      const predicted=data.roll as Roll,parts=splitGroupRoll(predicted);
      if(predicted.request.groupSize){
        const descriptors=parts.map(r=>({id:r.request.id,count:r.kinds.length,visibility:r.request.visibility||'all'}));
        this.registerGroupParts(predicted.request.id,descriptors,this.transport.id);
        await this.send({type:'group-parts',id:predicted.request.id,parts:descriptors});
        this.worker.postMessage({type:'release',id:predicted.request.id});this.worker.postMessage({type:'retain',rolls:parts,catalog:this.catalog});
      }
      for(const actual of parts){
      let roll=actual;
      if(hiddenRequest(actual.request)){
        const lease=this.reservations.get(actual.request.id);if(!lease||lease.broker!==this.authority())throw Error('暗骰计算期间房间权威变化，请重投');
        const masked=maskRoll(actual,this.catalog),frozen=this.privateAudiences.get(actual.request.id);
        if(!frozen)throw Error('缺少提交时的暗骰权限快照');
        const audience=frozen.filter(id=>id===this.transport.id||lease.members.includes(id)&&this.peers.get(id)?.ready&&now()-this.peers.get(id)!.lastSeen<12000);
        masked.roll.secret=await this.keys.seal(masked.details,actual.request.visibility as 'self'|'gm'|'players',audience);roll=masked.roll;
        this.privateAudiences.delete(actual.request.id);
        this.rememberSecret(roll,masked.details);
      }
      const {poses,contacts,...meta}=roll;
      const bytes=await encodeRoll({...meta,collisions:contacts.length,contacts:contacts.length},poses,contacts),sha=await hash(bytes),chunks=split(bytes);
      const members=[...this.peers.values()].filter(p=>p.ready&&now()-p.lastSeen<12000&&p.version===BUILD&&(!roll.masked||this.reservations.get(roll.request.id)?.members.includes(p.id))).map(p=>p.id);
      // A 100-dice stress roll takes ~25 s to predict per peer; the product tier needs only seconds.
      const window=Math.max(roll.kinds.length>20?90000:20000,roll.request.batch?15000+roll.request.batch.size*2000:0);
      const out:Outgoing={uploading:true,roll,chunks,hash:sha,bytes:bytes.length,wait:new Set([this.transport.id,...members]),members,at:now(),started:false,retry:0,acks:new Set(members),lastStartRetry:0,window,viewers:new Set([this.transport.id,...members])};
      this.outgoing.set(roll.request.id,out);this.rolls.set(roll.request.id,actual);this.addRecord(actual);
      this.requests.delete(roll.request.id);
      this.log('trajectory-ready',{id:roll.request.id,source:roll.request.source,theme:roll.request.theme,physicsMs:roll.physicsMs,steps:roll.steps,collisions:roll.collisions,diagnostics:roll.diagnostics,bytes:bytes.length,rawBytes:poses.byteLength,chunks:chunks.length,hash:sha,results:roll.results,members});
      this.bus.postMessage({type:'prepare',roll:actual});
      if(members.length){await this.send({type:'offer',id:roll.request.id,total:chunks.length,bytes:bytes.length,hash:sha,members});
        for(let i=0;i<chunks.length;i++){await this.send({type:'chunk',id:roll.request.id,index:i,data:chunks[i]});if(i%8===7)await new Promise(r=>setTimeout(r,8))}
        await this.send({type:'chunks-done',id:roll.request.id});}
      out.uploading=false;out.at=now();await this.maybeStart(out);
      }
      this.requests.delete(predicted.request.id);this.privateAudiences.delete(predicted.request.id);
    }catch(e){this.worker.postMessage({type:'release',id:pending.id});this.fail('physics/trajectory',e);
      if(hiddenRequest(pending)){this.cancelSecret(pending.id);await this.send({type:'secret-failed',id:pending.id,reason:errorText(e)})}
      if(pending.source!==this.transport.id)await this.send({type:'roll-rejected',to:pending.source,id:pending.id,reason:errorText(e)});
    }finally{this.next();this.state()}
  }
  private async sendReady(id:string,inbound:Received){
    if(this.disabled||this.inbound.get(id)!==inbound)return;
    const peer=this.peers.get(inbound.source);
    if(!peer||peer.rtt<0){setTimeout(()=>{void this.sendReady(id,inbound).catch(e=>this.fail('ready-clock',e))},150);return}
    if(!this.inbound.has(id))return;
    await this.send({type:'ready',id,to:inbound.source,hash:inbound.assembly.sha});this.log('trajectory-verified',{id,theme:this.rolls.get(id)?.request.theme,hash:inbound.assembly.sha,source:inbound.source,rtt:peer.rtt});
    if(inbound.start&&this.inbound.get(id)===inbound)await this.receive({v:1,build:BUILD,from:inbound.source,type:'start',id,...inbound.start},inbound.source);
  }
  private async repair(out:Outgoing){
    if(out.repairing)return;out.repairing=true;
    try{while(this.outgoing.get(out.roll.request.id)===out){
      const next=[...(out.repairs||[])].find(([,indices])=>indices.size);if(!next)break;
      const [member,indices]=next,index=indices.values().next().value!;indices.delete(index);
      if(!out.members.includes(member)||!out.acks.has(member)&&out.started)continue;
      await this.send({type:'chunk',id:out.roll.request.id,index,data:out.chunks[index],to:member});
    }}catch(error){if(this.outgoing.get(out.roll.request.id)===out)this.fail('trajectory-repair',error);}
    finally{out.repairing=false;}
  }
  private registerGroupParts(id:string,parts:{id:string;count:number;visibility:string}[],source:string){
    const lease=this.reservations.get(id),size=lease?.request.groupSize;
    if(!lease||lease.request.source!==source||lease.broker!==this.authority()||!Number.isInteger(size)||!Array.isArray(parts)||parts.length!==size||parts.length<1||parts.length>100||parts.some((p,i)=>p.id!==`${id}.g${i}`||!Number.isInteger(p.count)||p.count<1||!validVisibility(p.visibility))||parts.reduce((n,p)=>n+p.count,0)>100)throw Error('非法群体轨迹清单');
    for(const [index,p]of parts.entries()){
      const request:Request={...lease.request,id:p.id,count:p.count,visibility:p.visibility as Request['visibility'],groupSize:undefined,batch:{id,index,size:parts.length}};
      const prior=this.reservations.get(p.id);if(prior&&JSON.stringify(prior.request)!==JSON.stringify(request))throw Error('群体轨迹清单发生变化');
      this.reservations.set(p.id,{...lease,request});
    }
  }
  private async maybeStart(out:Outgoing){
    if(out.uploading||out.started||out.wait.size)return;
    const batch=out.roll.request.batch;
    if(batch){
      const peers=[...this.outgoing.values()].filter(r=>r.roll.request.batch?.id===batch.id);
      if(peers.length!==batch.size||peers.some(r=>r.uploading||r.wait.size||r.started))return;
      const maxRtt=Math.max(0,...[...this.peers.values()].filter(p=>p.ready).map(p=>p.rtt));
      const lead=out.members.length?Math.min(1500,Math.max(100,maxRtt*1.5+50)):24;
      const entries=peers.map(row=>({id:row.roll.request.id,hash:row.hash}));
      await this.dispatchStart(peers,{type:'start-group',id:batch.id,entries},lead,batch.id);return;
    }
    const maxRtt=Math.max(0,...[...this.peers.values()].filter(p=>p.ready).map(p=>p.rtt));
    const lead=out.members.length?Math.min(1500,Math.max(70,maxRtt*1.5+35)):24;
    await this.dispatchStart([out],{type:'start',id:out.roll.request.id,hash:out.hash},lead,out.roll.request.id);
  }
  private async dispatchStart(rows:Outgoing[],packet:any,lead:number,reservationId:string){
    let dispatched=false,start=0;
    for(const row of rows){row.started=true;row.dispatching=true;}
    const arm=(wire:any)=>{
      // Start once at actual dispatch, never when enqueued or when its SDK ACK
      // arrives. Rejected-rate retries and uncertain-ACK repair reuse this time.
      if(dispatched){wire.start=start;return;}
      // Published incumbent tracks cannot be rewritten. They are final-pose
      // colliders, so preserve their settled lower bound for the new animation.
      start=Math.max(now()+lead,...this.settledAt.values());wire.start=start;dispatched=true;
      for(const row of rows){row.start=start;row.lastStartRetry=now();this.retainUntilExit(row.roll,start);this.bus.postMessage({type:'start',id:row.roll.request.id,at:start});}
      for(const row of rows)row.dispatching=false;
      this.finishReservation(reservationId);
      if(packet.type==='start-group')this.log('group-start-scheduled',{id:reservationId,start,count:rows.length,leadMs:lead});
      else this.log('roll-start-scheduled',{id:reservationId,start,leadMs:lead,collisionWaitMs:Math.max(0,start-now()-lead),prepareWaitMs:now()-rows[0].at,hash:rows[0].hash});
      setTimeout(()=>this.next(),Math.max(0,start-now()+1));
    };
    try{if(rows[0].members.length)await this.send(packet,arm);else arm(packet);}
    catch(error){
      if(!dispatched){for(const row of rows){row.started=false;row.start=undefined;row.lastStartRetry=0;}throw error;}
      // The authoritative trajectory is already armed. Releasing physics or
      // rejecting the roll here would corrupt it. Existing bounded start-ACK
      // recovery delivers the same hash/time; late peers play the full trace.
      this.log('start-send-unconfirmed',{id:reservationId,start,reason:errorText(error)});
    }finally{for(const row of rows)row.dispatching=false;}
    this.next();
  }
  private async beginSecret(descriptor:Request){
    if(descriptor.source!==this.transport.id||this.privateRunning.has(descriptor.id))return;
    const saved=this.requests.get(descriptor.id),request=saved?.request;
    if(!request||!hiddenRequest(request)||['source','name','count','kind','theme','bodyColor','visibility'].some(k=>(request as any)[k]!==(descriptor as any)[k]))throw Error('暗骰授权与原始提交不一致');
    if(this.pending)throw Error('暗骰授予时本地仍有未完成的预测');
    this.privateRunning.add(descriptor.id);this.pending=request;
    this.worker.postMessage({type:'retain',rolls:[...this.heldRolls.values()],catalog:this.catalog});
    this.worker.postMessage({request,catalog:this.catalog,view:this.viewport});
    this.pendingTimer=setTimeout(()=>{this.worker.terminate();this.disabled=true;this.pending=undefined;this.refreshReady();this.cancelSecret(request.id);void this.send({type:'secret-failed',id:request.id,reason:'暗骰预测超时'});this.fail('hidden-timeout',request.id)},request.count>20?180000:40000);
    this.state();
  }
  private finishReservation(id:string){if(this.reservation?.request.id===id)this.reservation=undefined;}
  private cancelSecret(id:string){
    const request=this.reservations.get(id)?.request??this.outgoing.get(id)?.roll.request??this.rolls.get(id)?.request??this.requests.get(id)?.request;
    const master=request?.batch?.id||(request?.groupSize?id:undefined),ids=new Set([id]);
    if(master){ids.add(master);for(const [child,lease]of this.reservations)if(lease.request.batch?.id===master)ids.add(child);for(const [child,out]of this.outgoing)if(out.roll.request.batch?.id===master)ids.add(child);}
    // One failed preparation aborts the entire unstarted barrier. Leaving its
    // siblings/reservation alive would hold the next group until lease timeout.
    for(const key of ids){this.finishReservation(key);this.reservations.delete(key);this.requests.delete(key);this.privateRunning.delete(key);this.privateAudiences.delete(key);this.queue=this.queue.filter(r=>r.id!==key);
      if(!this.started.has(key)&&!this.outgoing.get(key)?.started){this.outgoing.delete(key);this.inbound.delete(key);this.rolls.delete(key);this.records.delete(key);this.secrets.delete(key);this.releasePhysics(key);this.bus.postMessage({type:'discard',id:key});}}
    this.sendRecords();this.next();
  }
  private rememberSecret(roll:Roll,details?:SecretDetails){
    if(!roll.secret)throw Error('缺少暗骰封装');
    this.secrets.set(roll.request.id,{request:roll.request,kinds:roll.kinds,commitment:roll.secret.commitment,details,complete:false,revealed:false});
    while(this.secrets.size>100){const id=[...this.secrets].find(([,a])=>a.complete)?.[0];if(!id)throw Error('暗骰记录容量已满');this.secrets.delete(id);}
  }
  private addRecord(roll:Roll){if(roll.masked)return;const r=roll.request;
    this.records.set(r.id,{id:r.id,source:r.source,visibility:r.visibility,name:r.name,color:r.bodyColor,kinds:roll.kinds,results:roll.results,modifier:r.modifier??0,total:roll.formulaData?roll.formulaData.rows.reduce((n,r)=>n+r.total,0):roll.results.reduce((s,v,i)=>s+dieTotalValue(roll.kinds[i],v),r.modifier??0),secret:hiddenRequest(r),revealed:false,complete:false,at:now(),canReveal:false,formulaData:roll.formulaData});
    while(this.records.size>DICE_HISTORY_LIMIT)this.records.delete(this.records.keys().next().value!);this.sendRecords();
  }
  private completeRecord(id:string){const secret=this.secrets.get(id);if(secret)secret.complete=true;const record=this.records.get(id);if(record){record.complete=true;record.canReveal=record.secret&&!record.revealed&&record.source===this.transport.id;this.sendRecords();if(this.visibleRecord(record))this.bus.postMessage({type:'result-bubble',record});}}
  private visibleRecord(record:ResultRecord){return canSeeDiceHistory({rollerId:record.source,hidden:record.secret&&!record.revealed,visibility:record.revealed?'all':record.visibility},{playerId:this.transport.id,role:this.transport.role||''});}
  private sendRecords(){this.bus.postMessage({type:'history',records:[...this.records.values()].filter(record=>this.visibleRecord(record)).sort((a,b)=>a.at-b.at).slice(-DICE_HISTORY_LIMIT)});}
  private async reveal(id:string){const a=this.secrets.get(id);
    if(!a||a.request.source!==this.transport.id||!a.details||!a.complete)throw Error('只能公开自己已结算的暗骰');
    const message={type:'secret-reveal',id,request:a.request,kinds:a.kinds,commitment:a.commitment,details:a.details};
    await this.send({type:'secret-reveal-packed',id,data:await packReveal(message)});await this.acceptReveal(message,this.transport.id);
  }
  private async acceptReveal(p:any,source:string){
    const known=this.secrets.get(p.id),r=p.request as Request;
    const prior=this.records.get(p.id);if(prior&&(!prior.secret||prior.source!==source))throw Error('不能用暗骰公开覆盖其他投掷');
    if(!r||typeof p.id!=='string'||p.id.length<1||p.id.length>80||r.id!==p.id||r.source!==source||!hiddenRequest(r)||!validVisibility(r.visibility)||typeof r.name!=='string'||r.name.length<1||r.name.length>100||!validBodyColor(r.bodyColor)||!Array.isArray(p.kinds)||p.kinds.length!==r.count||!Number.isInteger(r.count)||r.count<1||r.count>100||!this.catalog.themes[r.theme])throw Error('非法暗骰公开身份');
    if(known&&(known.request.source!==source||known.commitment!==p.commitment||JSON.stringify(known.kinds)!==JSON.stringify(p.kinds)))throw Error('暗骰公开与原承诺不一致');
    if(known&&['kind','count','theme','bodyColor','visibility','source','name'].some(k=>(r as any)[k]!==(known.request as any)[k]))throw Error('公开更改了原暗骰身份/外观');
    validateDetails(r,p.kinds,p.details,this.catalog);if(await secretCommitment(p.details)!==p.commitment)throw Error('公开点数与投掷时的承诺不符');
    if(this.records.get(p.id)?.revealed)return;
    if(known){known.details=p.details;known.revealed=true;known.complete=true;}
    const d=p.details as SecretDetails,record:ResultRecord={id:p.id,source,visibility:r.visibility,name:r.name,color:r.bodyColor,kinds:p.kinds,results:d.results,modifier:d.modifier,total:d.formulaData?d.formulaData.rows.reduce((n,r)=>n+r.total,0):d.results.reduce((s,v,i)=>s+dieTotalValue(p.kinds[i],v),d.modifier),secret:true,revealed:true,complete:true,at:this.records.get(p.id)?.at??now(),canReveal:false,formulaData:d.formulaData};
    this.records.set(p.id,record);while(this.records.size>DICE_HISTORY_LIMIT)this.records.delete(this.records.keys().next().value!);
    this.sendRecords();this.bus.postMessage({type:'suite-unmask-archive',id:p.id,details:d});this.bus.postMessage({type:'result-bubble',record,highlight:true});this.log('hidden-revealed',{id:p.id,owner:source});
  }
  private recordReceipt(peer:string,event:string,detail:any){this.receipts.push({peer,event,...detail});if(this.receipts.length>120)this.receipts.splice(0,30)}
  private async receive(p:any,source:string,receivedAt=now()){
    if(!p||p.v!==1||p.from!==source)throw Error('消息身份/协议不匹配');
    if(p.from===this.transport.id)return;
    const bytes=sizeOf(p);if(bytes>MAX_MESSAGE_BYTES)throw Error('接收消息超过 15 KB');this.bytesReceived+=bytes;this.packetsReceived++;
    if(p.to&&p.to!==this.transport.id)return;
    if(p.build!==BUILD){this.log('peer-version-mismatch',{source,build:p.build});return}
    const existing=this.peers.get(source);if(existing)existing.lastSeen=now();
    switch(p.type){
      case 'hello':{
        if(typeof p.name!=='string'||p.name.length>100||!validBodyColor(p.color))throw Error('Invalid peer name/colour');
        const role=this.transport.resolveRole?await this.transport.resolveRole(source):p.role;
        if(role!=='GM'&&role!=='PLAYER')throw Error('无法验证玩家的枭熊角色: '+source);
        if(typeof p.session!=='string'||!/^[0-9a-f-]{36}$/.test(p.session))throw Error('暗骰会话身份不合法');
        const restarted=!!existing&&existing.session!==p.session;
        await this.keys.remember(source,p.publicKey,restarted);
        if(restarted){
          existing!.ready=false;existing!.rtt=-1;existing!.offset=0;this.clocks.delete(source);for(const [nonce,probe]of this.probes)if(probe.to===source)this.probes.delete(nonce);
          this.log('peer-session-restarted',{source});
          // A reload has lost its old wrapping key and prepared traces. Never silently replay or
          // make a hidden payload public to recover it. Future submissions use the new handshake.
          for(const [id,inbound]of this.inbound)if(inbound.source===source){this.inbound.delete(id);this.rolls.delete(id);this.records.delete(id);this.bus.postMessage({type:'discard',id});this.cancelSecret(id)}
          for(const [id,out]of this.outgoing)if(!out.started&&out.members.includes(source)){await this.send({type:'abort',id,reason:'玩家刷新，旧会话准备已失效，请重新投掷'});this.bus.postMessage({type:'discard',id});this.outgoing.delete(id);this.rolls.delete(id);this.records.delete(id);this.releasePhysics(id);this.cancelSecret(id);this.fail('peer-restarted',id)}
          this.sendRecords();
        }
        if(!Number.isSafeInteger(p.born)||p.born<0)throw Error('Invalid authority join order');
        if(!this.ready)this.born=Math.max(this.born,p.born+1);
        const isNew=!existing;this.peers.set(source,{id:source,session:p.session,name:p.name,color:p.color,role,lastSeen:now(),ready:p.ready===true,rtt:existing?.rtt??-1,offset:existing?.offset??0,version:p.build,born:p.born});
        if(isNew||restarted){await this.send({type:'hello',ready:this.ready,name:this.transport.name,to:source});this.log('peer-joined',{source,name:p.name})}if(isNew||restarted||!this.clocks.get(source)?.some(s=>now()-s.at<4000))await this.ping(source);this.state();break;
      }
      case 'secret-request':{
        const r=p.request as Request;
        if(!r||!existing?.ready||r.source!==source||r.authority!==source||r.name!==existing.name||!hiddenRequest(r)||!validVisibility(r.visibility)||r.seed!==0||r.modifier!==0||typeof r.id!=='string'||r.id.length>80||!Number.isInteger(r.count)||r.count<1||r.count>100||!validBodyColor(r.bodyColor)||(!KINDS.includes(r.kind as any)&&r.kind!=='mixed')||!this.catalog.themes[r.theme])throw Error('非法暗骰预约');
        if(this.authority()!==this.transport.id){await this.send({type:'roll-rejected',to:source,id:r.id,reason:'房间权威已变化，请重试'});break}
        try{this.accept(r);await this.send({type:'request-ack',id:r.id,to:source})}catch(error){await this.send({type:'roll-rejected',to:source,id:r.id,reason:errorText(error)})}break;
      }
      case 'secret-grant':{
        const r=p.request as Request;
        if(source!==this.authority()||!r||!hiddenRequest(r)||!validVisibility(r.visibility)||r.authority!==r.source||r.seed!==0||r.modifier!==0||typeof r.id!=='string'||r.id.length>80||!Number.isInteger(r.count)||r.count<1||r.count>100||!this.catalog.themes[r.theme]||(!KINDS.includes(r.kind as any)&&r.kind!=='mixed')||!Array.isArray(p.members)||p.members.length>64||!p.members.includes(source)||!p.members.includes(r.source))throw Error('非法暗骰计算授权');
        if(typeof r.name!=='string'||!r.name.length||r.name.length>100||!validBodyColor(r.bodyColor)||!p.members.every((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=100)||new Set(p.members).size!==p.members.length)throw Error('暗骰授权名单/外观不合法');
        if(!p.members.includes(this.transport.id))break;
        const previous=this.reservations.get(r.id);if(previous&&JSON.stringify(previous.request)!==JSON.stringify(r))throw Error('暗骰预约冲突');
        if(!previous)this.reservations.set(r.id,{request:r,broker:source,at:now(),members:p.members});
        try{await this.beginSecret(r)}catch(error){this.cancelSecret(r.id);await this.send({type:'secret-failed',id:r.id,reason:errorText(error)});throw error}break;
      }
      case 'secret-failed':{const lease=this.reservations.get(p.id);if(lease&&(source===lease.request.source||source===lease.broker)){this.cancelSecret(p.id);this.fail('hidden-aborted',String(p.reason));}break}
      case 'secret-reveal':await this.acceptReveal(p,source);break;
      case 'secret-reveal-packed':{if(!existing?.ready)throw Error('未知会话公开暗骰');const message=await unpackReveal(p.data);if(message.id!==p.id)throw Error('暗骰公开包身份不匹配');await this.acceptReveal(message,source);break;}
      case 'roll-request':{
        const r=p.request as Request;
        validateRecipe(r);
        if(!r||r.source!==source||r.authority!==this.transport.id||!existing||!existing.ready||r.name!==existing.name||
          typeof r.id!=='string'||r.id.length>80||!Number.isInteger(r.seed)||r.seed<0||r.seed>0xffffffff||
          hiddenRequest(r)||!Number.isInteger(r.count)||r.count<1||r.count>100||!validBodyColor(r.bodyColor)||!validModifier(r.modifier)||(!KINDS.includes(r.kind as any)&&r.kind!=='mixed')||!this.catalog.themes[r.theme])throw Error('Invalid authenticated roll request');
        if(this.authority()!==this.transport.id){await this.send({type:'roll-rejected',to:source,id:r.id,reason:'房间权威已变化，请重试'});break}
        try{this.accept(r);await this.send({type:'request-ack',id:r.id,to:source})}
        catch(error){await this.send({type:'roll-rejected',to:source,id:r.id,reason:errorText(error)})}break;
      }
      case 'request-ack':{const r=this.requests.get(p.id);if(r?.authority===source){r.status='房间已收到，正在准备…';this.log('request-accepted',{id:p.id,authority:source})}break}
      case 'queue-status':{const r=this.requests.get(p.id);if(r?.authority===source){r.status=p.space?'桌面空间不足，等待前一批演出结束后继续投掷':`等待房间计算，第 ${Number(p.position)||1} 条`;this.state()}break}
      case 'roll-rejected':{const r=this.requests.get(p.id);if(r?.authority===source){this.requests.delete(p.id);this.privateAudiences.delete(p.id);this.fail('authority-rejected',p.reason)}break}
      case 'ping':await this.send({type:'pong',to:source,nonce:p.nonce,received:receivedAt,remote:now()},packet=>{packet.remote=now();});break;
      case 'pong':{const probe=this.probes.get(p.nonce);if(!probe||probe.to!==source)break;this.probes.delete(p.nonce);const end=receivedAt,elapsed=end-probe.t;
        // Four timestamps exclude both paced sending and serial-inbox work. Old
        // peers without t2 still use the original estimate; no barrier is bypassed.
        if(!existing||!Number.isFinite(p.remote)||Math.abs(p.remote)>Number.MAX_SAFE_INTEGER||!Number.isFinite(elapsed)||elapsed<0||elapsed>10000)break;
        let rtt=elapsed,offset=p.remote-(probe.t+end)/2;
        if(p.received!==undefined){const processing=p.remote-p.received;
          if(!Number.isFinite(p.received)||Math.abs(p.received)>Number.MAX_SAFE_INTEGER||processing<0||processing>elapsed+1)break;
          rtt=Math.max(0,elapsed-processing);offset=((p.received-probe.t)+(p.remote-end))/2;
        }
        const samples=[...(this.clocks.get(source)||[]).filter(s=>end-s.at<10000),{at:end,rtt,offset}].slice(-8);this.clocks.set(source,samples);const best=[...samples].sort((a,b)=>a.rtt-b.rtt)[0];existing.rtt=best.rtt;existing.offset=best.offset;break;}
      case 'offer':{
        if(source!==this.authority()&&this.reservations.get(p.id)?.request.source!==source)throw Error('非房间权威或授权暗骰来源发送轨迹');
        if(!this.ready||!Array.isArray(p.members)||!p.members.includes(this.transport.id))break;
        if(this.started.has(p.id))break;
        const pending=this.inbound.get(p.id);if(pending){if(pending.source!==source||pending.assembly.sha!==p.hash)throw Error('冲突的轨迹清单');if(pending.prepared)await this.sendReady(p.id,pending);break}if(this.inbound.size>=64)throw Error('接收轨迹队列已满');
        if(typeof p.id!=='string'||p.id.length>80)throw Error('Invalid roll id');
        this.inbound.set(p.id,{source,assembly:new Assembly(p.total,p.bytes,p.hash),at:now(),retry:0,processing:false,prepared:false});await this.ping(source);break;
      }
      case 'chunk':{
        const inbound=this.inbound.get(p.id);if(!inbound||inbound.source!==source)break;
        inbound.assembly.add(p.index,p.data);inbound.at=now();
        // The tail is a prompt NACK opportunity, not a mandatory 2.5 second stall for a lost chunk.
        if(p.index===inbound.assembly.total-1&&inbound.assembly.missing().length&&inbound.retry===0){inbound.retry++;
          await this.send({type:'missing',to:source,id:p.id,indices:inbound.assembly.missing()})}
        if(!inbound.processing&&!inbound.assembly.missing().length){inbound.processing=true;const bytes=await inbound.assembly.finish();let roll=await decodeRoll(bytes) as Roll;
          if(roll.request.id!==p.id||roll.request.authority!==source||!this.catalog.themes[roll.request.theme]||roll.kinds.some(k=>!KINDS.includes(k)))throw Error('轨迹身份/皮肤/骰型不合法');
          if(roll.request.batch){const expected=this.reservations.get(p.id)?.request;if(!expected||expected.source!==source||JSON.stringify(expected.batch)!==JSON.stringify(roll.request.batch)||expected.count!==roll.kinds.length||expected.visibility!==roll.request.visibility)throw Error('群体轨迹与授权不符');}
          if(roll.masked){
            const lease=this.reservations.get(p.id),pack=roll.secret;
            if(!lease||lease.request.source!==source||lease.broker!==this.authority()||!hiddenRequest(roll.request)||roll.request.source!==source||roll.request.seed!==0||roll.request.modifier!==0||roll.diagnostics||!roll.results.every(v=>v===0)||!pack||pack.scope!==roll.request.visibility||!Array.isArray(pack.audience)||pack.audience.length>64||!pack.audience.includes(source)||!Array.isArray(pack.keys)||pack.keys.length>63||!/^[0-9a-f]{64}$/.test(pack.commitment))throw Error('暗骰公开轨迹未脱敏/授权不合法');
            if(['kind','theme','bodyColor','visibility','source','name'].some(k=>(roll.request as any)[k]!==(lease.request as any)[k])||(!lease.request.recipe&&roll.request.count!==lease.request.count)||!!roll.request.recipe!==!!lease.request.recipe)throw Error('暗骰轨迹更改了预约');
            const details=await this.keys.open(pack,source,p.id);this.rememberSecret(roll,details??undefined);
            if(details)roll=unmaskRoll(roll,details,this.catalog);
          }else if((source!==this.authority()&&this.reservations.get(p.id)?.request.source!==source)||hiddenRequest(roll.request)||roll.kinds.some((k,i)=>!this.catalog.dice[k].outcomes.some(o=>o.value===roll.results[i])))throw Error('公开轨迹权威/结果不合法');
          const request=this.requests.get(p.id);if(request&&(request.request.seed!==roll.request.seed||request.request.source!==roll.request.source||request.request.theme!==roll.request.theme||request.request.bodyColor!==roll.request.bodyColor||(!request.request.recipe&&request.request.count!==roll.request.count)||request.request.kind!==roll.request.kind||(request.request.modifier??0)!==(roll.request.modifier??0)))throw Error('权威更改了原请求');
          this.requests.delete(p.id);
          this.rolls.set(p.id,roll);this.addRecord(roll);this.bus.postMessage({type:'prepare',roll});}
        break;
      }
      case 'chunks-done':{const inbound=this.inbound.get(p.id);if(inbound?.source===source&&!inbound.processing&&inbound.assembly.missing().length){
        inbound.retry++;await this.send({type:'missing',to:source,id:p.id,indices:inbound.assembly.missing()})}break}
      case 'retire':{const held=this.heldRolls.get(p.id);if(held?.request.authority===source)this.releasePhysics(p.id);break}
      case 'missing':{const out=this.outgoing.get(p.id);if(!out||!out.members.includes(source)||!Array.isArray(p.indices)||p.indices.length>out.chunks.length)break;
        for(const index of p.indices)if(!Number.isInteger(index)||index<0||index>=out.chunks.length)throw Error('Invalid repair index');
        out.repairs??=new Map();const indices=out.repairs.get(source)||new Set<number>();for(const index of p.indices)indices.add(index);out.repairs.set(source,indices);
        // The receive lane must remain free for pong/ready/start-ack while paced
        // repair packets are sent. Duplicate NACKs coalesce into the same pump.
        void this.repair(out);break;}
      case 'ready':{const out=this.outgoing.get(p.id);if(!out||out.hash!==p.hash||!out.members.includes(source))break;out.wait.delete(source);this.log('peer-prepared',{id:p.id,source,hash:p.hash});await this.maybeStart(out);break;}
      case 'group-parts':{this.registerGroupParts(p.id,p.parts,source);break;}
      case 'start-group':{
        const lease=this.reservations.get(p.id);if(!lease||lease.request.source!==source||!Array.isArray(p.entries)||p.entries.length!==lease.request.groupSize||p.entries.some((entry:any,i:number)=>entry.id!==`${p.id}.g${i}`))throw Error('非法群体起播屏障');
        await Promise.all(p.entries.map((entry:any)=>this.receive({...p,type:'start',id:entry.id,hash:entry.hash},source)));break;
      }
      case 'start':{const inbound=this.inbound.get(p.id),roll=this.rolls.get(p.id),peer=this.peers.get(source);
        const previous=this.started.get(p.id);if(previous){if(previous.source!==source||previous.hash!==p.hash)throw Error('冲突的开播指令');await this.send({type:'start-ack',id:p.id,to:source,hash:p.hash});break}
        if(!Number.isFinite(p.start))throw Error('无效开播时间');
        // The offer may be retried after a lost initial manifest. Its sender
        // remains authenticated when the later offer/trajectory is accepted.
        if(!inbound)break;
        if(inbound.source!==source||inbound.assembly.sha!==p.hash)throw Error('开播身份/散列不匹配');
        if(!roll||!inbound.prepared||!peer||peer.rtt<0){inbound.start={hash:p.hash,start:p.start};break;}
        let localStart=p.start-peer.offset;const late=now()-localStart;if(late>0)this.log('late-network-start',{id:p.id,lateMs:late});
        if(late < -30000)throw Error('开播时间超出实验时钟范围');
        // A slow spectator uses the SAME verified trajectory from its beginning;
        // it must not jump past the complete animation or resample the result.
        if(late>250)localStart=now()+70;
        this.retainUntilExit(roll,localStart);this.worker.postMessage({type:'retain',rolls:[roll],catalog:this.catalog});this.finishReservation(roll.request.batch?.id||p.id);this.started.set(p.id,{source,hash:p.hash,at:now()});this.bus.postMessage({type:'start',id:p.id,at:localStart});this.inbound.delete(p.id);await this.send({type:'start-ack',id:p.id,to:source,hash:p.hash});this.next();break;}
      case 'start-ack':{const out=this.outgoing.get(p.id);if(out&&out.hash===p.hash)out.acks.delete(source);break;}
      case 'receipt':this.recordReceipt(source,p.event,p.detail);this.log('peer-receipt',{source,event:p.event,...p.detail});
        if(p.event==='render-complete'||p.event==='render-cancelled')this.viewerFinished(p.detail?.roll,source);this.state();break;
      case 'abort':{const inbound=this.inbound.get(p.id),lease=this.reservations.get(p.id);if(inbound?.source===source||lease&&(lease.request.source===source||lease.broker===source)){this.inbound.delete(p.id);this.rolls.delete(p.id);this.records.delete(p.id);this.sendRecords();this.cancelSecret(p.id);this.bus.postMessage({type:'discard',id:p.id});this.fail('remote-abort',p.reason)}break;}
    }
  }
  private async tick(){
    const t=now();if(t-this.lastState>1000){this.lastState=t;this.state()}
    if(this.catalog&&t-this.lastPresence>4000){this.lastPresence=t;await this.send({type:'hello',ready:this.ready,name:this.transport.name});
      if(this.authority()===this.transport.id)for(const [index,r] of this.queue.entries())if(r.source!==this.transport.id)
        await this.send({type:'queue-status',to:r.source,id:r.id,position:index+1,space:!!this.waitingForSpace});}
    for(const [id,peer] of this.peers)if(t-peer.lastSeen>15000){this.peers.delete(id);this.keys.forget(id);this.clocks.delete(id);this.log('peer-left',{id,name:peer.name})}
    if(this.reservation){const lease=this.reservation;if((lease.request.source!==this.transport.id&&!this.peers.has(lease.request.source))||t-lease.at>240000){await this.send({type:'secret-failed',id:lease.request.id,reason:'暗骰来源离线或预约超时'});this.cancelSecret(lease.request.id)}
      else if(Math.floor((t-lease.at)/500)%5===0)await this.send({type:'secret-grant',request:lease.request,members:lease.members});}
    for(const [id,lease] of this.reservations)if(t-lease.at>300000){this.reservations.delete(id);this.privateRunning.delete(id);}
    for(const [id,entry] of this.started)if(t-entry.at>60000)this.started.delete(id);
    for(const [id,probe] of this.probes)if(t-probe.t>10000)this.probes.delete(id);
    for(const [id,accepted] of this.accepted)if(t-accepted>240000)this.accepted.delete(id);
    for(const [id,r] of this.requests){if(r.authority!==this.transport.id&&t-r.at>240000){this.requests.delete(id);this.privateAudiences.delete(id);this.fail('request-timeout',`${id} authority=${r.authority} 排队/预测超出 240 秒上限`)}}
    for(const [id,inbound] of this.inbound){
      const inboundWindow=inbound.assembly.bytes>500000?120000:30000;
      if(t-inbound.at>inboundWindow){this.cancelSecret(id);this.fail('receive-timeout',id);continue}
      if(inbound.processing&&!inbound.prepared&&t-inbound.at>(inbound.retry+1)*2500){inbound.retry++;const roll=this.rolls.get(id);if(roll)this.bus.postMessage({type:'prepare',roll});}
      if(!inbound.processing&&t-inbound.at>(inbound.retry+1)*2500&&inbound.retry<40){inbound.retry++;await this.send({type:'missing',to:inbound.source,id,indices:inbound.assembly.missing()})}
    }
    for(const [id,out] of this.outgoing){
      if(out.uploading||out.dispatching)continue;
      if(!out.started&&t-out.at>2500){for(const member of out.wait){
        if(member===this.transport.id||member===out.roll.request.source)continue;
        out.wait.delete(member);this.log('spectator-preparation-late',{id,member});
      }await this.maybeStart(out);}
      if(!out.started&&t-out.at>(out.retry+1)*2500&&out.retry<out.window/2500){out.retry++;if(out.wait.has(this.transport.id))this.bus.postMessage({type:'prepare',roll:this.rolls.get(id)||out.roll});for(const member of out.wait)if(member!==this.transport.id)await this.send({type:'offer',to:member,id,total:out.chunks.length,bytes:out.bytes,hash:out.hash,members:out.members})}
      if(out.started&&out.acks.size&&t-out.lastStartRetry>1000){out.lastStartRetry=t;if(t-out.start!>20000){this.log('spectator-start-unconfirmed',{id,members:[...out.acks]});out.acks.clear();}
        else for(const member of out.acks){await this.send({type:'offer',to:member,id,total:out.chunks.length,bytes:out.bytes,hash:out.hash,members:out.members});await this.send({type:'start',to:member,id,start:out.start,hash:out.hash});}}
      if(!out.started&&t-out.at>out.window){await this.send({type:'abort',id,reason:`等待播放器准备超时（${out.window/1000} 秒）`});this.bus.postMessage({type:'discard',id});this.outgoing.delete(id);this.rolls.delete(id);this.releasePhysics(id);this.cancelSecret(id);this.fail('prepare-timeout',`${id} 等待 ${[...out.wait].join(',')}`)}
      else if(out.started&&t-out.at>60000)this.outgoing.delete(id);
    }
    this.next();
  }
}
