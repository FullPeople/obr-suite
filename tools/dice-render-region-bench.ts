// Diagnostic only: no pass/fail timing threshold on a shared CPU host.
import * as T from 'three';
import {DiceRenderRegion} from '../extensions/workbench-dice3d/src/render-region';
import {Session} from 'node:inspector';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {writeFileSync} from 'node:fs';
function fixture(count:number){
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-5.34,5.34,4.14,-2.54,.1,150);camera.position.set(0,43.33,-7.64);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
 const space=new T.Group();space.scale.x=-1;scene.add(space);
 const light=new T.DirectionalLight();light.position.set(-2.4,9,4.2);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.5,far:40});light.shadow.bias=-.0003;light.shadow.normalBias=.02;scene.add(light);
 const ground=new T.Mesh(new T.PlaneGeometry(38,22),new T.ShadowMaterial({opacity:.32}));ground.rotation.x=-Math.PI/2;ground.position.y=-.015;ground.receiveShadow=true;scene.add(ground);
 const region=new DiceRenderRegion(scene,camera,light,ground),view={width:1280,height:800,pixelsPerDie:120,pixelRatio:1};
 const geometry=new T.BoxGeometry(1,1,1);geometry.computeBoundingBox();const material=new T.MeshPhysicalMaterial();
 for(let i=0;i<count;i++){const body=new T.Mesh(geometry,material);body.position.set((i%10-4.5)*.6,.6+(i%3)*.5,(Math.floor(i/10)-4.5)*.4);body.quaternion.setFromEuler(new T.Euler(.17*i,.31*i,.13*i));body.castShadow=true;for(let j=0;j<3;j++)body.add(new T.Mesh(geometry,new T.MeshBasicMaterial()));region.register(body);space.add(body);}
 return()=>region.get(view);
}
const session=new Session();session.connect();const post=(method:string,params:any={})=>new Promise<any>((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
const rows=[];let sink=0;const timingIterations=5000,allocationIterations=1000;
for(const count of [1,20,100]){
 const run=fixture(count);for(let i=0;i<500;i++)sink+=run()?.width??0;(globalThis as any).gc?.();
 const times=[];for(let i=0;i<timingIterations;i++){const start=performance.now();sink+=run()?.width??0;times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);(globalThis as any).gc?.();
 await post('HeapProfiler.startSampling',{samplingInterval:8192,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
 for(let i=0;i<allocationIterations;i++)sink+=run()?.width??0;
 const {profile}=await post('HeapProfiler.stopSampling');
 const selfBytes=(node:any):number=>node.selfSize+node.children.reduce((sum:number,child:any)=>sum+selfBytes(child),0);
 const sampledBytes=selfBytes(profile.head);const row={count,timingIterations,allocationIterations,ms:{mean:times.reduce((a,b)=>a+b,0)/times.length,p50:times[Math.floor(times.length*.50)],p95:times[Math.floor(times.length*.95)],p99:times[Math.floor(times.length*.99)],max:times.at(-1)},v8EstimatedAllocation:{samplingIntervalBytes:8192,totalBytes:sampledBytes,bytesPerGet:sampledBytes/allocationIterations,includeCollected:true}};
 rows.push(row);console.log(JSON.stringify(row));
}
session.disconnect();
const result={label:process.env.BENCH_LABEL||'current',environment:{node:process.version,v8:process.versions.v8,three:T.REVISION,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length},scope:'Pure Node helper get(), one directional PCF shadow and 3 registered outline children per die. Cached equal-sized BoxGeometry bounds; no physics/WebGL/browser, texture, GPU or worker timing. Allocation is V8 statistical heap sampling in a separate instrumented loop, not exact allocation count. Shared host timing is noisy.',rows,sink};
writeFileSync(process.env.BENCH_OUT||'.local-evidence/dice-render-region/bench.json',JSON.stringify(result,null,2)+'\n');
