// Scoped generation, original guide preservation and actual state functions.
// DOM layout/SDK integration are covered separately by announcement-scope-browser.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {build} from 'rolldown';
import {workbenchAnnouncement} from './workbench-announcement.mjs';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local-evidence/announcement-unit');mkdirSync(out,{recursive:true});
const web=process.env.DND_CARD_WEB_ROOT;assert.ok(web,'Set DND_CARD_WEB_ROOT to the exact paired Web checkout');
const legacy=readFileSync(join(root,'public/announcement.md'),'utf8'),modern=await workbenchAnnouncement(web);
let count=0;function check(name,value){assert.ok(value,name);count++;}
check('Legacy retirement stays legacy',legacy.includes('该插件不再更新')&&!modern.includes('该插件不再更新'));
check('Legacy dated history preserved',legacy.includes('## 2026-09-27-一 [history]'));
check('Modern history is paired Web output',modern.includes('# Full Suite 新版公告')&&modern.includes('[history]'));
const store=new Map(),opened=[];globalThis.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
globalThis.location={origin:'https://synthetic.test'};globalThis.window=globalThis;
const functionSource=(file,names)=>{const text=readFileSync(join(root,file),'utf8');return names.map(name=>{const m=text.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}','m'));assert.ok(m,name);return m[0];}).join('\n');};
const state=functionSource('src/cluster-row.ts',['fetchAnnouncementVersion','applyAnnounceBlink','refreshAnnouncementVersion']);
const daily=functionSource('src/background.ts',['localDayStamp','maybeShowDailyAnnouncement']);
const notices={suite:legacy,'suite-dev':modern};const saved={};let blink=false;
globalThis.document={getElementById:()=>({classList:{toggle:(key,value)=>{blink=value;}}})};
let currentChannel='suite';globalThis.fetch=async url=>{check('Read own asset '+currentChannel,url===`https://synthetic.test/${currentChannel}/${currentChannel==='suite'?'announcement.md':'assets/announcement-dev.md'}`);return {ok:true,text:async()=>notices[currentChannel]};};
for(const channel of ['suite','suite-dev']){
 currentChannel=channel;
 const entry=join(out,channel+'.ts');writeFileSync(entry,`import {renderAnnouncementImportant} from '${root}/src/announcement-important';import {assetUrl} from '${root}/src/asset-base';import {ANNOUNCEMENT_FILE,ANNOUNCEMENT_MODAL_ID,ANNOUNCEMENT_SEEN_KEY,ANNOUNCEMENT_DAILY_KEY} from '${root}/src/announcement-source';
 const ANNOUNCEMENT_MD_URL=assetUrl(ANNOUNCEMENT_FILE),LS_ANNOUNCE_SEEN=ANNOUNCEMENT_SEEN_KEY;let cachedAnnounceVersion:string|null=null;
 const ANNOUNCE_MD_URL=ANNOUNCEMENT_MD_URL,ANNOUNCE_URL=assetUrl('dm-announcement.html'),ANNOUNCE_MODAL_ID=ANNOUNCEMENT_MODAL_ID,LS_ANNOUNCE_DAILY=ANNOUNCEMENT_DAILY_KEY,LS_ANNOUNCE_SEEN_VERSION=ANNOUNCEMENT_SEEN_KEY;
 const OBR={player:{getRole:async()=> 'GM'},modal:{open:async value=>(globalThis as any).recordOpened(value)}};
 ${state}\n${daily}
 export {renderAnnouncementImportant,refreshAnnouncementVersion,maybeShowDailyAnnouncement,ANNOUNCEMENT_SEEN_KEY,ANNOUNCEMENT_DAILY_KEY};`);
 const result=await build({input:entry,plugins:[{name:'channel',transform(code){return code.includes('import.meta.env.BASE_URL')?code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/'+channel+'/')):undefined;}}],output:{format:'esm'}});
 const api=await import('data:text/javascript;base64,'+Buffer.from(result.output.find(o=>o.type==='chunk').code).toString('base64'));
 globalThis.recordOpened=value=>opened.push(value);
 for(const lang of ['zh','en']){const guide=api.renderAnnouncementImportant(lang);check(channel+' '+lang+' collapsed by default',guide.startsWith('<details class="announcement-important"><summary>'));check(channel+' '+lang+' three proper images',(guide.match(new RegExp('https://synthetic.test/'+channel+'/owner-step[123]\\.png','g'))||[]).length===3);check(channel+' '+lang+' both original steps',guide.includes('Owner Only')&&guide.includes('Set Owner'));check(channel+' '+lang+' original final note',guide.includes(lang==='zh'?'其他人的卡对他来说是只读的。':'Other players\' cards are read-only to them.'));}
 await api.refreshAnnouncementVersion();check(channel+' cold unread',blink);
 const version=notices[channel].match(/^\s*-\s*(\d+\.\d+\.\d+(?:[-.][\w]+)*)\s*[·\-—]/m)[1];
 localStorage.setItem(api.ANNOUNCEMENT_SEEN_KEY,version);await api.refreshAnnouncementVersion();check(channel+' remembered read',!blink);
 localStorage.setItem(api.ANNOUNCEMENT_SEEN_KEY,'previous-version');await api.refreshAnnouncementVersion();check(channel+' release change unread',blink);
 const before=opened.length;await api.maybeShowDailyAnnouncement();await api.maybeShowDailyAnnouncement();check(channel+' once daily',opened.length===before+1);check(channel+' own modal',opened.at(-1).id===(channel==='suite'?'com.obr-suite/dm-announcement':'com.obr-suite/workbench-announcement'));
 saved[channel]={key:api.ANNOUNCEMENT_SEEN_KEY,daily:api.ANNOUNCEMENT_DAILY_KEY,version};
}
check('Seen keys independent',saved.suite.key!==saved['suite-dev'].key);check('Daily keys independent',saved.suite.daily!==saved['suite-dev'].daily);
check('Switching keeps both reads',Object.values(saved).every(value=>localStorage.getItem(value.key)===value.version));
const webEntry=join(out,'web.ts');writeFileSync(webEntry,`export * from '${resolve(web)}/src/platform/announcement';`);const webResult=await build({input:webEntry,output:{format:'esm'}});const webApi=await import('data:text/javascript;base64,'+Buffer.from(webResult.output.find(o=>o.type==='chunk').code).toString('base64'));
webApi.rememberAnnouncementVersion('standalone-test','standalone');webApi.rememberAnnouncementVersion('suite-test','suite');check('Web modes independent',webApi.readAnnouncementVersion('standalone')==='standalone-test'&&webApi.readAnnouncementVersion('suite')==='suite-test');check('Web acknowledgement does not overwrite hosts',Object.values(saved).every(value=>localStorage.getItem(value.key)===value.version));
check('Web changed version becomes pending',webApi.announcementPending(webApi.readAnnouncementVersion('suite'),'next-version'));
console.log(`Announcement scope: ${count} assertions passed; real room/browser layout not verified`);
