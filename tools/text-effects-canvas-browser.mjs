import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {chromium} from '@playwright/test';
const root=resolve('dist-workbench-dev'),out=resolve('.local-evidence/connectivity300/text-canvas');mkdirSync(out,{recursive:true});
const originArg=process.argv.includes('--origin')?process.argv[process.argv.indexOf('--origin')+1]:undefined;
let fixture='';const server=createServer((req,res)=>{if(req.url==='/host'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}const path=resolve(root,decodeURIComponent(req.url.split('?')[0].replace(/^\/suite-dev\//,'')));if(!path.startsWith(root+'\\')&&!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const local='http://127.0.0.1:'+server.address().port,origin=originArg||local+'/suite-dev/';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined)}),checks=[];
try{for(const theme of ['light','dark']){const context=await browser.newContext({viewport:{width:900,height:700},colorScheme:null});await context.route('**/*',r=>r.request().resourceType()==='script'?r.abort():r.continue());const page=await context.newPage();
 fixture='<html style="color-scheme:'+theme+'"><style>html,body{margin:0;background:rgb(31,172,145)}iframe{position:absolute;left:20px;top:20px;width:800px;height:600px;border:0;background:transparent}</style><iframe src="'+origin+'text-effect-display.html"></iframe></html>';
 await page.goto(local+'/host');const frame=page.frames().find(f=>f.url().startsWith(origin));assert(frame);await frame.waitForFunction(()=>document.styleSheets.length>0);await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const shot=await page.screenshot();const pixel=await page.evaluate(async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(22,22,1,1).data];},shot.toString('base64'));
 assert.deepEqual(pixel,[31,172,145,255]);checks.push({theme,pixel,transparent:true});writeFileSync(join(out,theme+'.png'),shot);await context.close();}
 const result={passed:true,checks,origin,realRoomVerified:false,scope:'Actual emitted HTML/CSS with application scripts blocked; native host layer requires room acceptance.'};writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));}
