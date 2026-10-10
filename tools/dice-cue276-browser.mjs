import {build} from 'vite';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const out=resolve(process.env.CUE276_OUT||'.local-evidence/cue276'),baseline=process.env.CUE276_BASELINE;
mkdirSync(out,{recursive:true});
const baselineEntry=resolve(out,'baseline-cue.ts');
const sourceDir=resolve('extensions/workbench-dice3d/src').replaceAll('\\','/');
const frozen=execFileSync('git',['show','2a7d1fade9da653a2688920183316386beea6c9e:extensions/workbench-dice3d/src/cue-renderer.ts'],{encoding:'utf8'}).replaceAll("from './","from '"+sourceDir+'/');
writeFileSync(baselineEntry,frozen);
const entry=resolve(out,'entry.ts');
writeFileSync(entry,`import {CueRenderer} from ${JSON.stringify(resolve('extensions/workbench-dice3d/src/cue-renderer.ts'))};
import {beginOverlayFrame} from ${JSON.stringify(resolve('extensions/workbench-dice3d/src/shared-overlay-canvas.ts'))};
import {buildCue} from ${JSON.stringify(resolve('extensions/workbench-dice3d/src/cue.ts'))};
import {CueRenderer as BaselineCueRenderer} from ${JSON.stringify(baselineEntry)};
Object.assign(window,{CueRenderer,BaselineCueRenderer,beginOverlayFrame,buildCue});`);
await build({configFile:false,plugins:baseline?[{name:'frozen-cue-baseline',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/src/cue-renderer.ts'))return execFileSync('git',['show',baseline+':extensions/workbench-dice3d/src/cue-renderer.ts'],{encoding:'utf8'});}}]:[],build:{outDir:out+'/runtime',emptyOutDir:true,lib:{entry,formats:['es'],fileName:()=> 'cue.js'}}});
const server=createServer((req,res)=>{if(req.url==='/cue.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(out+'/runtime/cue.js'));}else if(req.url==='/font.ttf'){res.end(readFileSync('extensions/workbench-dice3d/public/assets/fonts/Cinzel-Variable.ttf'));}else{res.setHeader('content-type','text/html');res.end('<style>html,body{margin:0;width:100%;height:100%;background:#16181c}canvas{position:absolute;inset:0;pointer-events:none}</style><script type="module" src="/cue.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const results=[];
 for(const dpr of [1,2]){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:dpr}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.CueRenderer);
  await page.evaluate(async()=>{const face=new FontFace('CinzelVariable','url(/font.ttf)',{weight:'400 900'});await face.load();document.fonts.add(face);});
  const pixelComparison=await page.evaluate(()=>{
   const reports=[];
   for(const style of ['sketch','comic','metal'])for(const color of [[.85,.69,.45],[.06,.09,.12]]){
    const stage=document.body,poses=new Float32Array([1.5,.4,-.8,0,0,0,1]);
    const roll={request:{id:'pixel276',name:'Player',bodyColor:'#dcd4ba',modifier:5},kinds:['d20'],results:[20],duration:0,frames:1,fps:60,poses};
    const cue=window.buildCue(roll,{width:innerWidth,height:innerHeight,pixelsPerDie:120},{glyph:color,style});
    for(const phase of [.16,.36,.62,.85]){
     const images=[];
     for(const Klass of [window.BaselineCueRenderer,window.CueRenderer]){
      const show=new Klass(stage,roll.request.id,roll.request.name,roll.request.bodyColor);show.prepareCue(cue);window.beginOverlayFrame(stage);show.draw(cue.beams[0].start+phase,cue,1);
      const c=stage.querySelector('canvas');images.push(c.getContext('2d').getImageData(0,0,c.width,c.height).data);show.destroy();
     }
     let difference=0,ink=0;
     for(let i=0;i<images[0].length;i+=4){if(images[0][i+3]>0||images[1][i+3]>0){ink++;for(let k=0;k<4;k++)difference+=Math.abs(images[0][i+k]-images[1][i+k]);}}
     reports.push({style,color,phase,ink,meanChannelDifference:ink?difference/(ink*4):0});
    }
   }
   return reports;
  });
  assert(pixelComparison.every(p=>p.ink>100&&p.meanChannelDifference<1),'retained glyphs/particles/style, bounded local trail raster differences');
  results.push({dpr,pixelComparison});
  for(const count of [1,20]){
   const result=await page.evaluate(async({count})=>{
    const stage=document.body,n=count,poses=new Float32Array(n*7);
    for(let i=0;i<n;i++){poses[i*7]=(i%5-2)*1.7;poses[i*7+1]=.4;poses[i*7+2]=(Math.floor(i/5)-1.5)*1.4;poses[i*7+6]=1;}
    const roll={request:{id:'cue276-'+count,name:'Player',bodyColor:'#dcd4ba',modifier:5},kinds:Array(n).fill('d20'),results:Array.from({length:n},(_,i)=>i%3?i%20+1:20),duration:0,frames:1,fps:60,poses};
    const cue=window.buildCue(roll,{width:innerWidth,height:innerHeight,pixelsPerDie:120},{glyph:[.85,.69,.45],style:'sketch'}),show=new window.CueRenderer(stage,roll.request.id,roll.request.name,roll.request.bodyColor);
    const prepareAt=performance.now();show.prepareCue(cue);const prepareMs=performance.now()-prepareAt;
    const times=[],gaps=[],draws=[];let previous=0;const begin=performance.now()-cue.firstBeam*1000;
    await new Promise(resolve=>{const frame=time=>{if(previous)gaps.push(time-previous);previous=time;const age=(time-begin)/1000;const at=performance.now();window.beginOverlayFrame(stage);show.draw(age,cue,1);times.push(performance.now()-at);draws.push({age,cost:times.at(-1)});if(age<cue.finalBeamEnd+.1)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
    // One readback confirms actual ink; repeated readback would bias timings and disable GPU canvas.
    window.beginOverlayFrame(stage);show.draw(cue.beams[0].start+.36,cue,1);
    const c=stage.querySelector('canvas'),ctx=c.getContext('2d'),data=ctx.getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=3;i<data.length;i+=4)if(data[i]>20)ink++;
    show.destroy();const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
    return{count,prepareMs,frames:times.length,drawP50:percentile(times,.5),drawP95:percentile(times,.95),drawMax:Math.max(...times),gapP95:percentile(gaps,.95),gapMax:Math.max(...gaps),gapsOver50:gaps.filter(v=>v>50).length,ink,draws};
   },{count});assert(result.ink>100);assert.deepEqual(errors,[]);results.push({dpr,...result});
  }
  await context.close();
 }
 writeFileSync(out+'/result.json',JSON.stringify({baseline:baseline||null,browser:await browser.version(),realRoom:false,results},null,2));
 console.log(JSON.stringify(results.map(({draws,pixelComparison,...r})=>pixelComparison?{...r,pixelCases:pixelComparison.length,maxMeanChannelDifference:Math.max(...pixelComparison.map(p=>p.meanChannelDifference))}:r),null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
