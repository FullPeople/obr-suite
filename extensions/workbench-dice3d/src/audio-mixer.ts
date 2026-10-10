import {DiceAudio,type RollThemeAudio} from './audio';
import {now,url,type Catalog,type ThemeID} from './types';
import type {AudioPlan} from './renderer';
import {DiceAssets} from './asset-loading';
import {diceCatalog} from './asset-catalog';

interface Track{engine:DiceAudio;plan:AudioPlan;loaded:Promise<RollThemeAudio>;at:number;started:boolean;hit:number;rule:number;stinger:boolean;releaseGeneration:number}
/** One shared browser context, independent voices/theme/cursor/lifetime per authoritative roll. */
export class RollAudioMixer{
  private root:DiceAudio;
  private tracks=new Map<string,Track>();
  private loading=new Map<string,Promise<RollThemeAudio>>();
  private catalog:Promise<Catalog>;
  private timer=0;private finishedPlayed=0;private finishedDropped=0;private volume=1;
  constructor(private report:(event:string,detail:unknown)=>void,assets=new DiceAssets(),catalog?:Catalog){this.root=new DiceAudio(null,undefined,assets);this.catalog=Promise.resolve(catalog||diceCatalog());}
  get played(){return this.finishedPlayed+[...this.tracks.values()].reduce((n,t)=>n+t.engine.played,0)}
  get dropped(){return this.finishedDropped+[...this.tracks.values()].reduce((n,t)=>n+t.engine.dropped,0)}
  state(){return this.root.state()}
  snapshot(){return {active:[...this.tracks.keys()],played:this.played,dropped:this.dropped,state:this.state()}}
  async resume(){await this.root.resume();this.report('audio-unlocked',{});await this.preload()}
  async warmup(){await this.preload()}
  private async preload(){const catalog=await this.catalog;await Promise.all(Object.keys(catalog.themes).map(id=>this.load(id as ThemeID)))}
  private load(id:ThemeID,stinger:AudioPlan['stinger']=null){const key=id+':'+(stinger||'roll');let promise=this.loading.get(key);if(!promise){promise=this.catalog.then(c=>{
    if(!c.themes[id])throw Error('来源音频主题不可用: '+id);return stinger?this.root.loadStinger(c.themes[id],url(''),stinger==='twenty'):this.root.loadRequired(c.themes[id],url(''));
  }).catch(error=>{if(this.loading.get(key)===promise)this.loading.delete(key);throw error;});this.loading.set(key,promise)}return promise}
  setVolume(value:number){this.volume=Math.max(0,Math.min(1,value));this.root.setVolume(this.volume);for(const t of this.tracks.values())t.engine.setVolume(this.volume)}
  prepare(id:string,theme:ThemeID,plan:AudioPlan){
    if(this.tracks.has(id))return;
    const track:Track={engine:this.root.fork(),plan,loaded:this.load(theme,plan.stinger),at:0,started:false,hit:0,rule:0,stinger:false,releaseGeneration:0};
    this.tracks.set(id,track);track.loaded.catch(error=>this.report('error',{message:`音频 ${id}: ${error}`}));
  }
  async release(id:string,at:number){
    const t=this.tracks.get(id);if(!t)throw Error('缺少已准备音频: '+id);
    if(t.started&&t.at===at)return;
    // Remember the desired clock while loading so a subsequent retime can supersede this release.
    t.at=at;
    const generation=++t.releaseGeneration,loaded=await t.loaded;if(this.tracks.get(id)!==t||t.releaseGeneration!==generation)return;
    t.at=at;t.engine.start(t.plan.impacts,loaded,at);t.started=true;
    if(this.root.state()!=='running')this.report('audio-needs-gesture',{roll:id});
    this.report('audio-roll-start',{roll:id,active:this.tracks.size});
    if(!this.timer)this.timer=window.setInterval(()=>this.tick(),20);
  }
  private stopIdleTimer(){if(this.timer&&![...this.tracks.values()].some(t=>t.started)){clearInterval(this.timer);this.timer=0}}
  pause(id:string){const t=this.tracks.get(id);if(t){t.releaseGeneration++;t.started=false;t.engine.stop('presentation-pause');this.stopIdleTimer();}}
  async retime(id:string,at:number){
    const t=this.tracks.get(id);if(!t||!t.at||(t.started&&t.at===at))return;
    const wall=now(),elapsed=(wall-at)/1000,previousElapsed=(wall-t.at)/1000;
    // Web Audio keeps playing during a blocked visual frame. Restart only cancelled future
    // reservations; a sound already dispatched and due on the old clock must not play twice.
    const pending=(time:number,index:number,cursor:number)=>time>=elapsed&&(!t.started||index>=cursor||time>previousElapsed);
    t.hit=t.plan.hits.findIndex((hit,index)=>pending(hit.t,index,t.hit));if(t.hit<0)t.hit=t.plan.hits.length;
    const rules=t.plan.rules||[];t.rule=rules.findIndex((rule,index)=>pending(rule.t,index,t.rule));if(t.rule<0)t.rule=rules.length;
    await this.release(id,at);
  }
  stop(id:string){const t=this.tracks.get(id);if(!t)return;this.finishedPlayed+=t.engine.played;this.finishedDropped+=t.engine.dropped;
    t.engine.dispose();this.tracks.delete(id);this.report('audio-roll-stop',{roll:id,remaining:this.tracks.size});
    this.stopIdleTimer();}
  private tick(){for(const [id,t] of this.tracks){if(!t.started)continue;
    const elapsed=(now()-t.at)/1000,rolling=t.plan.rolling;
    const index=Math.max(0,Math.min(rolling.activity.length-1,Math.floor(elapsed/rolling.step)));
    t.engine.update(elapsed,{activity:elapsed>t.plan.duration?0:rolling.activity[index]||0,pan:rolling.pan[index]||0});
    while(t.hit<t.plan.hits.length&&t.plan.hits[t.hit].t<=elapsed+.20){const hit=t.plan.hits[t.hit++];if(hit.t>=elapsed-.12)t.engine.reserveHit(hit.ordinal,hit.maximumFace,hit.t-elapsed)}
    const rules=t.plan.rules??[];
    while(t.rule<rules.length&&rules[t.rule].t<=elapsed+.20){const rule=rules[t.rule++];if(rule.t>=elapsed-.12){t.engine.reserveRule(rule.kind,rule.pan,rule.t-elapsed);this.report('audio-rule-cue',{roll:id,kind:rule.kind,at:rule.t});}}
    if(!t.stinger&&t.plan.stinger&&elapsed>=t.plan.stingerAt){t.stinger=true;if(elapsed-t.plan.stingerAt<=.12)t.engine.stinger(t.plan.stinger==='twenty')}
    if(elapsed>t.plan.duration+.5)this.stop(id);
  }}
}
