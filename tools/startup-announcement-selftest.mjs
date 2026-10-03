import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {StartupPresentation}=await load('../src/workbench/startup-presentation.ts');
const {dailyAnnouncement,afterVisiblePaint,announcementVersion,localDayStamp}=await load('../src/announcement-lifecycle.ts');
let count=0;const check=(value,label)=>{assert.ok(value,label);count++;};
const gate=new StartupPresentation();check(gate.ready,'host without a card window does not deadlock');
gate.hello('first','loading');check(!gate.ready,'first client starts blocked');
for(const phase of ['playing','waiting','fading']){gate.update('first',phase);check(!gate.ready,'blocked during '+phase);}
gate.update('unknown','complete');check(!gate.ready,'unknown client cannot unlock');gate.update('first','complete');check(gate.ready,'fade completion unlocks');
gate.update('first','playing');check(gate.ready,'late phase cannot replay an already completed intro');
gate.hello('second','loading');gate.update('first','complete');gate.hello('first','complete');check(!gate.ready,'old window or relay completion cannot unlock reentry');
gate.update('second','failed');gate.update('second','complete');check(!gate.ready,'failed document cannot emit late completion');
gate.update('second','cancelled');check(!gate.ready,'pagehide is not proof that a client window closed');gate.hello('third','complete');check(gate.ready,'late subscription uses completed snapshot');
gate.hello('legacy',undefined);check(gate.ready,'older clients with no intro lifecycle stay compatible');
let opens=0,warnings=0,day=null,role='GM',rejectOpen=false;let resolveRole;
const daily=dailyAnnouncement({role:async()=>role,readDay:()=>day,presentation:gate,open:async()=>{opens++;if(rejectOpen)throw Error('closed');},warn:()=>warnings++});
await daily();check(opens===1&&day===null,'requesting an open does not mark visible/read');rejectOpen=true;await daily();check(opens===2&&warnings===1&&day===null,'failed open is retryable and unread');rejectOpen=false;
day=localDayStamp();await daily();check(opens===2,'visible exposure daily stamp suppresses repeat');day=null;role='PLAYER';await daily();check(opens===2,'players are not auto-opened');role='GM';
gate.hello('fourth','playing');await daily();check(opens===2,'host waits while a card intro is active');gate.update('fourth','complete');await daily();check(opens===3,'host resumes after actual completion');
const delayed=dailyAnnouncement({role:()=>new Promise(r=>resolveRole=r),readDay:()=>null,presentation:gate,open:async()=>{opens++;},warn:()=>warnings++});
const old=delayed();await delayed();gate.hello('fifth','loading');resolveRole('GM');await old;check(opens===3,'new intro invalidates in-flight eligibility and duplicate request');gate.update('fifth','complete');
// Joined gate + automatic subscriber regression: pagehide is emitted on both
// reload and close. A slow new document has no bridge yet, but still owns intro.
const reloadGate=new StartupPresentation(),windowProxy={closed:false};let reloadOpens=0;
const reloadDaily=dailyAnnouncement({role:async()=> 'GM',readDay:()=>null,presentation:reloadGate,open:async()=>{reloadOpens++;},warn:error=>{throw error;}});
reloadGate.hello('before-reload','playing',windowProxy);
reloadGate.subscribe(()=>{void reloadDaily();});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
reloadGate.update('before-reload','cancelled');await settle();reloadGate.releaseClosedWindow();await settle();
check(!reloadGate.ready&&reloadOpens===0,'automatic host stays blocked between pagehide and slow replacement hello');
reloadGate.hello('after-reload','loading',windowProxy);reloadGate.update('before-reload','complete');await settle();
check(!reloadGate.ready&&reloadOpens===0,'same WindowProxy with a new document rejects old completion');
reloadGate.update('after-reload','fading');await settle();check(reloadOpens===0,'joined host stays blocked through new fade-out');
reloadGate.update('after-reload','complete');await settle();check(reloadOpens===1,'joined host opens once after replacement completes');
reloadGate.hello('closing','playing',windowProxy);reloadGate.update('closing','cancelled');await settle();
check(reloadOpens===1,'close pagehide itself still cannot authorize exposure');windowProxy.closed=true;reloadGate.releaseClosedWindow();await settle();
check(reloadGate.ready&&reloadOpens===2,'verified closed window releases host pending announcement');
reloadGate.hello('closing','complete',windowProxy);await settle();check(reloadOpens===2,'retired closed document cannot replay completion');
const relayOnly=new StartupPresentation();relayOnly.hello('relay-client','playing');relayOnly.update('relay-client','cancelled');relayOnly.releaseClosedWindow();
check(!relayOnly.ready,'relay disconnection without window evidence never guesses completion');
relayOnly.hello('relay-reentry','complete');check(relayOnly.ready,'relay reentry completion releases the gate');
const restarted=new StartupPresentation(),recoveredWindow={closed:false};let recoveredOpens=0;
const recoveredDaily=dailyAnnouncement({role:async()=> 'GM',readDay:()=>null,presentation:restarted,open:async()=>{recoveredOpens++;},warn:error=>{throw error;}});
// The real bridge adopts an authenticated recovered ping through hello with
// its source and document generation before checking daily eligibility.
restarted.hello('current-document','fading',recoveredWindow,200);restarted.subscribe(()=>{void recoveredDaily();});await recoveredDaily();
check(!restarted.ready&&recoveredOpens===0,'recovered host adopts ping snapshot and blocks active fade');
restarted.hello('previous-unseen-document','complete',recoveredWindow,100);await settle();
check(!restarted.ready&&recoveredOpens===0,'first-seen stale relay hello after host recovery cannot replace newer document');
restarted.hello('old-legacy','complete',recoveredWindow);await settle();check(!restarted.ready,'legacy hello cannot replace a generation-aware current document');
restarted.update('current-document','complete');await settle();check(recoveredOpens===1,'recovered current document opens host notice only on completion');
restarted.hello('replacement','playing',recoveredWindow,300);restarted.hello('current-document','complete',recoveredWindow,200);await settle();check(!restarted.ready&&recoveredOpens===1,'newer document supersedes known generation and rejects its delayed hello');
const historyGate=new StartupPresentation(),historyWindow={closed:false};let historyOpens=0;
const historyDaily=dailyAnnouncement({role:async()=> 'GM',readDay:()=>null,presentation:historyGate,open:async()=>{historyOpens++;},warn:error=>{throw error;}});
historyGate.hello('document-a','complete',historyWindow,100);historyGate.subscribe(()=>{void historyDaily();});
historyGate.hello('document-b','playing',historyWindow,200);historyGate.update('document-b','cancelled');await settle();
check(!historyGate.ready&&historyOpens===0,'A to B to Back navigation remains blocked before restored activation');
historyGate.hello('document-a','complete',historyWindow,100);await settle();check(historyOpens===0,'retired pre-BFCache identity cannot unlock current navigation');
// Actual Web pageshow creates a new activation identity/generation and rehello.
historyGate.hello('document-a-restored','fading',historyWindow,300);await settle();check(!historyGate.ready&&historyOpens===0,'restored A re-establishes its pending fade with fresh activation');
historyGate.update('document-a-restored','complete');await settle();check(historyGate.ready&&historyOpens===1,'restored A completion releases joined host exactly once');
historyGate.hello('document-b','complete',historyWindow,200);await settle();check(historyOpens===1,'late B cannot replay a host open after Back restoration');
check(announcementVersion('- 1.0.236-dev · test')==='1.0.236-dev','version parsing stays channel-safe');
function paint(){let next=0;const frames=new Map(),events=new Map();const doc={visibilityState:'hidden',addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};const win={addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),requestAnimationFrame:f=>{frames.set(++next,f);return next;},cancelAnimationFrame:n=>frames.delete(n)};return {doc,win,events,frame(){const values=[...frames.values()];frames.clear();values.forEach(fn=>fn());},visible(){doc.visibilityState='visible';events.get('visibilitychange')?.();}};}
let shown=0;const p=paint();afterVisiblePaint(()=>shown++,p.doc,p.win);p.frame();check(shown===0,'hidden modal is not exposed');p.visible();p.frame();check(shown===0,'first frame is not yet a visible paint');p.frame();check(shown===1,'visible painted content exposes once');p.visible();p.frame();check(shown===1,'repeated visibility events do not restamp');
const gone=paint();afterVisiblePaint(()=>shown++,gone.doc,gone.win);gone.visible();gone.frame();gone.events.get('pagehide')({persisted:false});gone.frame();check(shown===1,'dismissed modal cannot mark read on a stale frame');
const backgrounded=paint();afterVisiblePaint(()=>shown++,backgrounded.doc,backgrounded.win);backgrounded.visible();backgrounded.frame();backgrounded.doc.visibilityState='hidden';backgrounded.frame();check(shown===1,'backgrounding before paint delays exposure');backgrounded.visible();backgrounded.frame();backgrounded.frame();check(shown===2,'returning to foreground exposes content');
const cached=paint();afterVisiblePaint(()=>shown++,cached.doc,cached.win);cached.visible();cached.frame();cached.events.get('pagehide')({persisted:true});cached.frame();check(shown===2,'bfcache pauses pending exposure');cached.events.get('pageshow')();cached.frame();cached.frame();check(shown===3,'bfcache restore resumes exposure safely');
console.log(`Startup/announcement lifecycle: ${count} assertions passed; browser and real-room checks are separate`);
