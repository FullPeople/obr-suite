#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "rolldown";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const require=createRequire(import.meta.url);
const {chromium}=require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const out=mkdtempSync(join(tmpdir(),"three-dragon-vector-cards-"));
const base="extensions/three-dragon-ante/src/game/";
const sources=["stage/textures.ts","rules/cards.ts","rules/prompts.ts"].map(p=>base+p);
sources.push("tools/three-dragon-card-art-selftest.mjs");
const pins=()=>Object.fromEntries(sources.map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
const before=pins(),path=p=>JSON.stringify(resolve(p).replaceAll("\\","/"));
const entry=`
import {cardTexture} from ${path(sources[0])};
import {CARDS,CARD_BY_ID} from ${path(sources[1])};
import {cardName} from ${path(sources[2])};
import {REVISION} from 'three';
const maps=[],stats=new WeakMap();let rasterDraws=0;
const text=CanvasRenderingContext2D.prototype.fillText,draw=CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.fillText=function(value,x,y,...rest){const lines=stats.get(this.canvas)??[];lines.push({text:String(value),x,y,width:this.measureText(String(value)).width,font:this.font,ink:this.fillStyle});stats.set(this.canvas,lines);return text.call(this,value,x,y,...rest);};
CanvasRenderingContext2D.prototype.drawImage=function(...args){rasterDraws++;return draw.apply(this,args);};
const hash=bytes=>{let h=2166136261;for(const value of bytes)h=Math.imul(h^value,16777619);return(h>>>0).toString(16);};
const pixels=(canvas,box=[0,0,canvas.width,canvas.height])=>canvas.getContext('2d').getImageData(...box).data;
function create(id,lang){const map=cardTexture(id===null?null:CARD_BY_ID[id],lang);maps.push({id,lang,map});return maps.length-1;}
function snapshot(index){const {id,lang,map}=maps[index],data=pixels(map.image);return{id,lang,uuid:map.uuid,isCanvasTexture:map.isCanvasTexture,version:map.version,colorSpace:map.colorSpace,width:map.image.width,height:map.image.height,text:stats.get(map.image),hash:hash(data),artHash:hash(pixels(map.image,[90,185,330,345])),opaque:data.every((v,i)=>i%4!==3||v===255),pixelLevels:new Set(data).size};}
window.vectorAudit={cards:CARDS.map(c=>({...c,en:cardName(c.id,'en'),zh:cardName(c.id,'zh')})),create,snapshot,
 batch(lang){const start=performance.now();const ids=CARDS.map(c=>create(c.id,lang));return{ids,milliseconds:performance.now()-start};},
 snapshots:ids=>ids.map(snapshot),dispose:()=>maps.forEach(m=>m.map.dispose()),
 info:()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,devicePixelRatio,threeRevision:REVISION,rasterDraws}),
 show(ids){document.querySelector('main').replaceChildren(...ids.map(i=>{const canvas=maps[i].map.image;canvas.style.width='205px';canvas.style.height='294.4px';return canvas;}));},
 png:i=>maps[i].map.image.toDataURL('image/png').split(',')[1]};
`;
writeFileSync(join(out,"entry.ts"),entry);
await build({input:"vector-audit",platform:"browser",plugins:[{name:"audit-entry",resolveId(id){if(id==="vector-audit")return"\0vector-audit";},load(id){if(id==="\0vector-audit")return entry;}}],output:{file:join(out,"app.js"),format:"esm",codeSplitting:false}});
const app=readFileSync(join(out,"app.js"));
const html='<!doctype html><meta charset="utf-8"><title>Original geometric vector cards</title><style>body{background:#171719;color:#efe0bc;font:16px system-ui}main{display:flex;gap:14px;flex-wrap:wrap;width:890px}canvas{object-fit:contain}h1{font-size:18px}</style><h1>Original geometric vector cards — actual CanvasTexture, not a WebGL table</h1><main></main><script type="module" src="/stage/app.js"></script>';
const requests=[],errors=[],checks=[],measures={};
const server=createServer((req,res)=>{const pathname=new URL(req.url,"http://localhost").pathname;requests.push(pathname);res.setHeader("Cache-Control","no-store");
 if(pathname==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);}
 else if(pathname==="/stage/app.js"){res.setHeader("Content-Type","application/javascript");res.end(app);}
 else if(pathname==="/favicon.ico"){res.statusCode=204;res.end();}
 else{res.statusCode=404;res.end("Not found");}});
for(;;){try{await new Promise((done,fail)=>{const error=e=>{server.off("listening",listen);fail(e);};const listen=()=>{server.off("error",error);done();};server.once("error",error);server.once("listening",listen);server.listen(20000+Math.floor(Math.random()*30000),"127.0.0.1");});break;}catch(e){if(e.code!=="EADDRINUSE")throw e;}}
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:"msedge"});
const mark=label=>{checks.push(label);console.log(`PASS ${checks.length}: ${label}`);};
try{
 const page=await browser.newPage({viewport:{width:950,height:760}}),external=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 await page.goto(origin);await page.waitForFunction(()=>!!window.vectorAudit);
 measures.environment=await page.evaluate(()=>window.vectorAudit.info());
 const back=await page.evaluate(()=>window.vectorAudit.create(null,'en'));
 const backState=await page.evaluate(i=>window.vectorAudit.snapshot(i),back);
 assert.ok(backState.isCanvasTexture&&backState.opaque);assert.equal(backState.width,512);assert.equal(backState.height,736);assert.equal(backState.text.length,1);assert.equal(backState.text[0].text,'III');assert.ok(backState.pixelLevels>20);
 mark('Geometric III back returns a complete, opaque Three CanvasTexture synchronously');
 const batches={};for(const lang of ['en','zh'])batches[lang]=await page.evaluate(lang=>window.vectorAudit.batch(lang),lang);
 measures.create100CardsMilliseconds={en:batches.en.milliseconds,zh:batches.zh.milliseconds};
 const cards=await page.evaluate(()=>window.vectorAudit.cards),en=await page.evaluate(ids=>window.vectorAudit.snapshots(ids),batches.en.ids),zh=await page.evaluate(ids=>window.vectorAudit.snapshots(ids),batches.zh.ids);
 assert.equal(cards.length,100);assert.equal(new Set([...en,...zh].map(s=>s.uuid)).size,200);
 const inks={black:'#8a879b',blue:'#719bc3',brass:'#c6ab6b',bronze:'#c69566',copper:'#cf936e',gold:'#e3c37a',green:'#8ea77d',red:'#ce7965',silver:'#becbd3',white:'#ddd7c6'};
 const categories={en:{standard:'STANDARD',legendary:'LEGENDARY',mortal:'MORTAL'},zh:{standard:'龙',legendary:'传奇龙',mortal:'凡人'}};
 let wrapped=0;
 for(let i=0;i<cards.length;i++)for(const [lang,s]of[['en',en[i]],['zh',zh[i]]]){
  const c=cards[i];assert.ok(s.isCanvasTexture&&s.opaque);assert.equal(s.colorSpace,'srgb');assert.equal(s.width,512);assert.equal(s.height,736);assert.ok(s.pixelLevels>20);
  for(const [x,y]of[[42,116],[468,687]]){const rank=s.text.find(t=>t.x===x&&t.y===y);assert.equal(rank?.text,String(c.strength),`${c.id}/${lang} rank at ${x},${y}`);assert.equal(rank.ink,inks[c.color??'gold']);}
  const name=s.text.filter(t=>t.y>=574&&t.y<=619);assert.ok(name.length>=1&&name.length<=2,`${c.id}/${lang} needs at most two lines`);if(name.length===2)wrapped++;
  assert.equal(name.map(t=>t.text).join(lang==='en'?' ':'').replaceAll(' ',''),c[lang].replaceAll(' ',''),`Complete exact name for ${c.id}/${lang}`);
  assert.ok(name.every(t=>t.width<=414&&t.x===256),`${c.id}/${lang} name fits actual measured width`);
  assert.equal(s.text.find(t=>t.y===677)?.text,categories[lang][c.category]);
 }
 assert.ok(wrapped>0,'Actual long names exercise two-line fitting');measures.actualTwoLineNames=wrapped;
 mark('All 100 cards in both languages retain complete names, two rank positions, measured wrapping and independent textures');
 const byId=id=>cards.findIndex(c=>c.id===id),colorSamples=Object.keys(inks).map(color=>en[cards.findIndex(c=>c.category==='standard'&&c.color===color)].artHash);
 assert.equal(new Set(colorSamples).size,10,'All ten dragon color inks affect actual portrait pixels');
 assert.notEqual(en[byId('gold-2')].artHash,en[byId('kobold')].artHash,'Same-ink same-rank mortal has a different geometric silhouette');
 assert.equal(en[byId('gold-2')].artHash,en[byId('bahamut')].artHash,'Shared original dragon silhouette is intentional; legendary identity comes from its own label');
 for(let i=0;i<100;i++)assert.equal(en[i].artHash,zh[i].artHash,`Language keeps ${cards[i].id} vector drawing`);
 const signatures=values=>new Set(values.map(s=>JSON.stringify(s.text.map(t=>t.text)))).size;assert.equal(signatures(en),100);assert.equal(signatures(zh),100);
 mark('Original dragon/mortal shapes, ten colors and category/family labels remain distinct without invented per-family artwork');
 const duplicate=await page.evaluate(()=>window.vectorAudit.create('black-1','en'));
 assert.deepEqual((await page.evaluate(i=>window.vectorAudit.snapshot(i),duplicate)).text,en[0].text,'Repeated card draws exact same text, metrics, ink and placement');
 const idleBefore=await page.evaluate(ids=>window.vectorAudit.snapshots(ids),[back,duplicate]);await page.waitForTimeout(250);
 assert.deepEqual(await page.evaluate(ids=>window.vectorAudit.snapshots(ids),[back,duplicate]),idleBefore,'Synchronous vector textures have no delayed repaint');
 assert.equal((await page.evaluate(()=>window.vectorAudit.info())).rasterDraws,0,'Canvas uses no raster image draw calls');
 assert.deepEqual(external,[]);assert.ok(requests.every(p=>['/','/stage/app.js','/favicon.ico'].includes(p)),`No image, atlas or other asset requests: ${JSON.stringify(requests)}`);
 mark('Repeated labels are stable; synchronous textures have no delayed repaint, raster draw or asset network request');
 const longNameIndex=en.findIndex(s=>s.text.filter(t=>t.y>=574&&t.y<=619).length===2);assert.ok(longNameIndex>=0);measures.previewWrappedCard=cards[longNameIndex].id;
 const samples=[back,batches.en.ids[byId('black-1')],batches.zh.ids[byId('black-1')],batches.en.ids[byId('gold-13')],batches.en.ids[longNameIndex],batches.zh.ids[byId('bahamut')],batches.en.ids[byId('archmage')],batches.zh.ids[byId('sorcerer')]];
 await page.evaluate(ids=>window.vectorAudit.show(ids),samples);await page.screenshot({path:join(out,'original-vector-cards.png'),fullPage:true});
 writeFileSync(join(out,'long-name-vector.png'),Buffer.from(await page.evaluate(i=>window.vectorAudit.png(i),batches.en.ids[longNameIndex]),'base64'));
 await page.evaluate(()=>window.vectorAudit.dispose());
 assert.deepEqual(errors,[]);assert.deepEqual(pins(),before);
 mark('Actual bilingual vector card samples captured; source frozen and browser has no unhandled errors');
 writeFileSync(join(out,'result.json'),JSON.stringify({browser:browser.version(),checks,measures,requests,externalRequests:external,sourcePins:before,scope:'Actual Edge Canvas2D and Three CanvasTexture. Original geometric vector cardTexture only; no raster assets. CPU-side synchronous creation timings exclude pixel readback and GPU upload; no WebGL table, frame-rate or Owlbear UAT claim.'},null,2));
 console.log(`VECTOR_CARDS ${checks.length} groups PASS. Evidence: ${out}`);
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error.stack),checks,measures,requests,errors,sourcePins:before},null,2));console.error(out);throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));}
