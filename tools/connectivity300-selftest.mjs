import assert from 'node:assert/strict';
import {build} from 'rolldown';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),out=resolve('.local-evidence/connectivity300');mkdirSync(out,{recursive:true});
const checks=[];
for(const [name,input]of [['suite',resolve(process.env.CONNECTIVITY_BASELINE?'../obr-suite/src/workbench/relay.ts':'src/workbench/relay.ts')],['web',resolve(process.env.CONNECTIVITY_BASELINE?'../DND-card-web':process.env.DND_CARD_WEB_ROOT||'../web-connectivity300','src/platform/relay.ts')]]){
 const target=resolve(out,name+'-relay.mjs');await build({input,output:{file:target,format:'esm'}});const {Relay}=await import(pathToFileURL(target));
 let active=0,max=0,posts=0,failView=true,unknown=0,releaseBulk;const deliveredViews=[];
 let rejectOld;const rejectedOld=new Promise(resolve=>rejectOld=resolve);let oldAttempts=0;
 const bulk=new Promise(resolve=>releaseBulk=resolve);
 globalThis.fetch=async(_url,options={})=>{
  if(options.method!=='POST')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  posts++;const text=typeof options.body==='string'?options.body:new TextDecoder().decode(options.body),value=options.headers['Content-Encoding']?{}:JSON.parse(text);
  if(value.padding){await bulk;return Response.json({});}
  if(value.view==='retry-stale'){oldAttempts++;rejectOld();return Response.json({code:'REQUEST_CAPACITY',error:'busy'},{status:503,headers:{'Retry-After':'0.15'}});}
  if(value.view)deliveredViews.push(value.view);
  if(value.type==='save'){unknown++;return Response.json({error:'ambiguous'},{status:500});}
  if(value.type==='catalog'&&failView){failView=false;return Response.json({code:'REQUEST_CAPACITY',error:'busy'},{status:503,headers:{'Retry-After':'0.01'}});}
  active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return Response.json({});
 };
 const relay=new Relay('http://fixture/relay','fixture','client','fixture',()=>{});
 try{
  await Promise.all(Array.from({length:12},(_,i)=>relay.send({protocol:'full-suite-workbench/v1',type:'panelRpc',requestId:String(i)})));
  assert.equal(max,1,'one client must not flood the control admission lane');checks.push(name+': twelve control operations serialize');
  const held=relay.send({padding:'x'.repeat(3000)+'字'.repeat(1000)});
  await new Promise(r=>setTimeout(r,20));const start=performance.now();await relay.send({type:'ack'});assert(performance.now()-start<300,'control blocked behind bulk');releaseBulk();await held;checks.push(name+': control bypasses held bulk bytes');
  await relay.send({protocol:'full-suite-workbench/v1',type:'catalog',cards:[]});assert.equal(failView,false);checks.push(name+': refused view admission recovers');
  const stale=relay.send({protocol:'full-suite-workbench/v1',type:'catalog',view:'stale'}).catch(error=>error);
  const newest=relay.send({protocol:'full-suite-workbench/v1',type:'catalog',view:'newest'});await newest;
  assert.equal((await stale).code,'SUPERSEDED_VIEW');assert.deepEqual(deliveredViews,['newest']);checks.push(name+': superseded queued views never consume network bytes');
  const retrying=relay.send({protocol:'full-suite-workbench/v1',type:'rolls',view:'retry-stale'}).catch(error=>error);await rejectedOld;
  await relay.send({protocol:'full-suite-workbench/v1',type:'rolls',view:'fresh-history'});
  assert.equal((await retrying).code,'SUPERSEDED_VIEW');assert.equal(oldAttempts,1,'old history retried after fresh history');checks.push(name+': replaced view cannot resurrect history after admission retry');
  await assert.rejects(relay.send({protocol:'full-suite-workbench/v1',type:'save',requestId:'ambiguous'}));assert.equal(unknown,1,'unknown mutation replayed');checks.push(name+': ambiguous mutation never replays');
 }finally{relay.close();}
}
const geometry=resolve(out,'geometry.mjs');await build({input:resolve('src/modules/portals/geometry.ts'),output:{file:geometry,format:'esm'}});const {portalGeometry,insidePortal}=await import(pathToFileURL(geometry));
const portal={type:'IMAGE',position:{x:100,y:100},rotation:0,scale:{x:2,y:2},grid:{dpi:64,offset:{x:32,y:32}},image:{width:64,height:64}};
assert(insidePortal({x:240,y:100},portalGeometry(portal,150)));assert(!insidePortal({x:251,y:100},portalGeometry(portal,150)));checks.push('resized portal uses visible diameter');
const wide={...portal,rotation:90,scale:{x:-1,y:2},image:{width:1024,height:256},grid:{dpi:1024,offset:{x:0,y:0}}};const g=portalGeometry(wide,200);assert(Math.abs(g.center.x-50)<1e-6&&Math.abs(g.center.y)<1e-6);assert(insidePortal({x:50,y:95},g));assert(!insidePortal({x:110,y:0},g));checks.push('replacement image dimensions, noncentral anchor, rotation, mirror and ellipse');
const replaced={...portal,image:{width:2048,height:1024},grid:{dpi:2048,offset:{x:1024,y:512}},scale:{x:2,y:2}};assert(insidePortal({x:240,y:100},portalGeometry(replaced,150)));assert(!insidePortal({x:100,y:180},portalGeometry(replaced,150)));checks.push('image replacement retains fitted width and actual short edge');
const result={passed:true,checks,realRoomVerified:false};writeFileSync(resolve(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
