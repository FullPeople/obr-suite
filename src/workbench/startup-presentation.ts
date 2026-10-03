/** Only the already authenticated workbench bridge may update this gate. */
export class StartupPresentation {
 private client='';
 private phase='complete';
 private revision=0;
 private listeners=new Set<()=>void>();
 private retired=new Set<string>();
 private source:{readonly closed:boolean}|undefined;
 private clientStarted=0;
 private known(phase:unknown):phase is string{return typeof phase==='string'&&['loading','playing','waiting','fading','complete','failed','cancelled'].includes(phase);}
 /** A new document replaces the old client, even when its WindowProxy survives. */
 hello(client:string,phase:unknown,source?:{readonly closed:boolean},started?:unknown){
  if(!client||this.retired.has(client))return;
  const time=typeof started==='number'&&Number.isFinite(started)&&started>0?started:0;
  // Direct and relay messages may cross. The document/activation time rejects even an
  // old hello first observed after a newer client or a host restart.
  if(time<this.clientStarted||time===this.clientStarted&&time>0&&this.client!==client)return;
  if(time>this.clientStarted)this.clientStarted=time;
  if(client!==this.client){if(this.client)this.retired.add(this.client);this.client=client;this.phase='loading';this.source=undefined;this.revision++;}
  if(source)this.source=source;
  this.update(client,phase===undefined?'complete':phase);
 }
 update(client:string,phase:unknown){
  if(client!==this.client||!this.known(phase)||this.phase===phase)return;
  if(['complete','failed','cancelled'].includes(this.phase)&&phase!=='cancelled')return;
  this.phase=phase;this.revision++;this.listeners.forEach(listener=>listener());
 }
 /** pagehide also means reload/navigation. It cannot prove the window closed.
  * The host checks its previously authenticated WindowProxy, never a timer or
  * a client-provided flag. Relay-only clients remain blocked until reentry. */
 releaseClosedWindow(){
  if(!this.client||!this.source?.closed)return;
  this.retired.add(this.client);this.client='';this.source=undefined;this.phase='complete';this.revision++;this.listeners.forEach(listener=>listener());
 }
 get ready(){return !this.client||this.phase==='complete';}
 get token(){return this.revision;}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
}
export const workbenchStartup=new StartupPresentation();
