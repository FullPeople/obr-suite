import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium,expect}=createRequire('D:/Desktop/DND-card-web/package.json')('@playwright/test');
const out=process.env.RTC178_OUT||'F:/CodexWork/2026-09-20/w-xu/rtc178';mkdirSync(out,{recursive:true});
// Isolated research only. No production messages, permissions, or persistence.
// HTTP carries only SDP (simulates existing authenticated relay signaling).
const origin='http://127.0.0.1:5499',topOrigin='http://localhost:5499';
let offer,answer,signals=0;const signalDelay=40;
const shared=`
window.peer=new RTCPeerConnection({iceServers:[]});window.rtts=[];window.opened=0;
const waitIce=()=>new Promise(resolve=>{if(peer.iceGatheringState==='complete')return resolve();const on=()=>{if(peer.iceGatheringState==='complete'){peer.removeEventListener('icegatheringstatechange',on);resolve();}};peer.addEventListener('icegatheringstatechange',on);});
const signal=async(key,value)=>{if(value){await fetch('/signal/'+key,{method:'POST',body:JSON.stringify(value)});return;}for(;;){const response=await fetch('/signal/'+key);if(response.status===200)return response.json();await new Promise(r=>setTimeout(r,20));}};
const opened=channel=>{window.channel=channel;channel.onopen=()=>{window.opened=performance.now()};};
`;
const host=`${shared}
(async()=>{peer.ondatachannel=e=>{opened(e.channel);e.channel.onmessage=m=>e.channel.send(m.data)};const remote=await signal('offer');await peer.setRemoteDescription(remote);await peer.setLocalDescription(await peer.createAnswer());await waitIce();await signal('answer',peer.localDescription);})();
`;
const client=`${shared}
window.start=performance.now();(async()=>{const channel=peer.createDataChannel('workbench-prototype',{ordered:true});opened(channel);channel.onmessage=m=>{const data=JSON.parse(m.data);window.rtts.push(performance.now()-data.at)};await peer.setLocalDescription(await peer.createOffer());await waitIce();await signal('offer',peer.localDescription);await peer.setRemoteDescription(await signal('answer'));})();
window.measure=async(n,bytes=0)=>{window.rtts=[];for(let i=0;i<n;i++){const count=window.rtts.length;channel.send(JSON.stringify({id:i,at:performance.now(),payload:'x'.repeat(bytes)}));await new Promise((resolve,reject)=>{const limit=Date.now()+5000;const check=()=>{if(window.rtts.length>count)resolve();else if(Date.now()>limit)reject(Error('RTC timeout'));else setTimeout(check,0)};check()});}return [...window.rtts].sort((a,b)=>a-b);};
`;
const server=createServer(async(req,res)=>{const path=new URL(req.url,origin).pathname;
if(path.startsWith('/signal/')){signals++;await new Promise(r=>setTimeout(r,signalDelay));const key=path.slice(8);if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;if(key==='offer')offer=JSON.parse(body);else answer=JSON.parse(body);res.end('{}');return;}const value=key==='offer'?offer:answer;if(!value){res.writeHead(204);res.end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;}
res.setHeader('Content-Type','text/html');if(path==='/')res.end(`<iframe id="host" sandbox="allow-scripts allow-same-origin" src="${origin}/host"></iframe>`);else if(path==='/host')res.end(`<script>${host}</script>`);else if(path==='/client')res.end(`<script>${client}</script>`);else{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(5499,'0.0.0.0',r));const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext();
try{
 const room=await context.newPage();await room.goto(topOrigin);const tab=await context.newPage();await tab.goto(origin+'/client');assert.equal(await tab.evaluate(()=>window.opener),null);await expect.poll(()=>tab.evaluate(()=>window.channel?.readyState),{timeout:12000}).toBe('open');
 const count=signals,small=await tab.evaluate(()=>window.measure(150)),medium=await tab.evaluate(()=>window.measure(30,16000));assert.equal(signals,count,'application traffic must bypass HTTP signal server');
 const connection=await tab.evaluate(async()=>{const stats=await peer.getStats(),pair=[...stats.values()].find(s=>s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated),local=pair&&stats.get(pair.localCandidateId),remote=pair&&stats.get(pair.remoteCandidateId);return{setupMs:window.opened-window.start,maxMessageSize:peer.sctp.maxMessageSize,localCandidate:local?.candidateType,remoteCandidate:remote?.candidateType,protocol:local?.protocol,iceServers:peer.getConfiguration().iceServers.length};});
 const summary={browser:browser.version(),scope:'WebRTC research prototype; isolated cross-site sandbox host and unrelated tab, no Owlbear production integration',httpSignalDelayMs:signalDelay,httpRequestsForSignaling:count,httpRequestsDuring180DataMessages:signals-count,...connection,rttSmall:{p50:small[75],p95:small[Math.floor(small.length*.95)],max:Math.max(...small)},rtt16KB:{p50:medium[15],p95:medium[Math.floor(medium.length*.95)],max:Math.max(...medium)},boundaries:['Browser / platform / network policy may disable WebRTC or UDP. Keep existing transport fallback.','Must authenticate SDP via current relay; no automatic room authority from peer connection.','New page refresh requires renegotiation; production must prevent duplicate mutation replay.','Cards can exceed negotiated maxMessageSize; require bounded chunking / flow control if adopted.']};
 writeFileSync(join(out,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
