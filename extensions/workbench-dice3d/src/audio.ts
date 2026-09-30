/**
 * Dice audio, ported from Desktop Dice `audio_engine.cpp` (XAudio2) onto Web Audio.
 *
 * Fixed voice pools that are never stolen, an equal-power stereo matrix fed by the same screen
 * projection the renderer uses, one master volume, and hard stop on interrupt. A shot that finds no
 * free voice is dropped and counted, exactly like the native engine, instead of being silently
 * stretched or faded.
 */
import {now,type Theme} from './types';
import * as N from './native';
import {ruleSound} from './rule-sound';
import {DiceAssets} from './asset-loading';
import {AUDIO_MAPPING,IMPACT_VOICES,RESULT_HIT_VOICES,resultHitGain,resultHitRate,UI_EMPHASIS_GAIN,
  type AudioImpact,type ImpactStrength} from './audio-map';

interface Voice{left:GainNode;right:GainNode;merger:ChannelMergerNode;source:AudioBufferSourceNode|null;endsAt:number}
export interface LoadedThemeAudio{impacts:Record<'die_on_ground'|'die_on_die',Record<ImpactStrength,AudioBuffer>>;
  rolling:AudioBuffer;tension:AudioBuffer;natural_1:AudioBuffer;natural_20:AudioBuffer;mix:Record<string,number>}
export interface RollingState{activity:number;pan:number}

export class DiceAudio{
  constructor(context:AudioContext|null=null,cache?:Map<string,LoadedThemeAudio>,private assets=new DiceAssets()){this.ctx=context;if(cache)this.buffers=cache}
  private decoded=new Map<string,Promise<AudioBuffer>>();
  private ctx:AudioContext|null=null;
  private master:GainNode|null=null;
  private impactVoices:Voice[]=[];
  private hitVoices:Voice[]=[];
  private rolling:Voice|null=null;
  private rollingBuffer:AudioBuffer|null=null;
  private rollingVolume=0;
  private rollingPan=0;
  private rollingStarted=false;
  private stingerVoice:Voice|null=null;
  private buffers=new Map<string,LoadedThemeAudio>();
  private ruleBuffers=new Map<string,AudioBuffer>();
  private impacts:AudioImpact[]=[];
  private impactCursor=0;
  private themeAudio:LoadedThemeAudio|null=null;
  private themeId='';
  private atWall=0;
  private volume=1;
  volumeSetting=1;
  dropped=0;
  played=0;
  state(){return this.ctx?this.ctx.state:'closed'}

  /** Assets may decode while suspended; audible playback still requires the user's gesture. */
  private ensure():AudioContext|null{
    if(this.ctx&&this.master)return this.ctx;
    try{
      const Ctor=window.AudioContext||(window as any).webkitAudioContext;
      if(!Ctor)return null;
      this.ctx=this.ctx||new Ctor();
      this.master=this.ctx.createGain();
      this.master.gain.value=this.volume;
      this.master.connect(this.ctx.destination);
      this.impactVoices=Array.from({length:IMPACT_VOICES},()=>this.makeVoice());
      this.hitVoices=Array.from({length:RESULT_HIT_VOICES},()=>this.makeVoice());
      this.rolling=this.makeVoice();
      this.stingerVoice=this.makeVoice();
      return this.ctx;
    }catch(error){throw Error('Web Audio 初始化失败: '+String(error))}
  }
  private makeVoice():Voice{
    const ctx=this.ctx!;
    const left=ctx.createGain(),right=ctx.createGain(),merger=ctx.createChannelMerger(2);
    left.gain.value=Math.SQRT1_2;right.gain.value=Math.SQRT1_2;
    left.connect(merger,0,0);right.connect(merger,0,1);merger.connect(this.master!);
    return{left,right,merger,source:null,endsAt:0};
  }
  async resume(){const ctx=this.ensure();if(!ctx)throw Error('Web Audio 不可用');if(ctx.state==='suspended')await ctx.resume()}
  fork(){const ctx=this.ensure();if(!ctx)throw Error('Web Audio 不可用');const child=new DiceAudio(ctx,this.buffers,this.assets);child.decoded=this.decoded;child.ruleBuffers=this.ruleBuffers;child.setVolume(this.volume);child.ensure();return child}
  dispose(){this.stop('dispose');for(const voice of [...this.impactVoices,...this.hitVoices,this.rolling!,this.stingerVoice!]){
    if(voice){voice.left.disconnect();voice.right.disconnect();voice.merger.disconnect()}}
    this.master?.disconnect();}
  setVolume(value:number){
    this.volume=Math.max(0,Math.min(1,value));
    if(this.master)this.master.gain.value=this.volume;
  }
  /** Decodes the theme's ten strict wavs once; a missing or undecodable file fails the roll. */
  async load(theme:Theme,base:string):Promise<LoadedThemeAudio>{
    const ctx=this.ensure();
    if(!ctx)throw Error('Web Audio 不可用');
    const cached=this.buffers.get(theme.id);
    if(cached)return cached;
    const decode=(path:string)=>{let pending=this.decoded.get(path);if(!pending){pending=this.assets.bytes(path).then(data=>ctx.decodeAudioData(data.slice(0))).catch(error=>{throw Error(`音频解码 ${base+path}: ${String(error)}`);});this.decoded.set(path,pending);}return pending;};
    const impacts={die_on_ground:{} as Record<ImpactStrength,AudioBuffer>,die_on_die:{} as Record<ImpactStrength,AudioBuffer>};
    await Promise.all((['die_on_ground','die_on_die'] as const).flatMap(surface=>
      (['light','medium','heavy'] as const).map(async strength=>{impacts[surface][strength]=await decode(theme.audio.impacts[surface][strength])})));
    const [rolling,tension,natural_1,natural_20]=await Promise.all([theme.audio.rolling,theme.audio.tension,theme.audio.natural_1,theme.audio.natural_20].map(decode));
    const audio:LoadedThemeAudio={impacts,
      rolling,tension,natural_1,natural_20,
      mix:theme.audio.mix as unknown as Record<string,number>};
    this.buffers.set(theme.id,audio);this.themeId=theme.id;
    return audio;
  }
  /** Starts one roll's schedule. `atWall` is the layer's actual release time on the shared clock. */
  start(impacts:AudioImpact[],audio:LoadedThemeAudio,atWall:number){
    this.stop('new_roll');
    this.impacts=impacts;this.impactCursor=0;this.themeAudio=audio;this.atWall=atWall;
    this.rollingBuffer=audio.rolling;this.rollingVolume=0;this.rollingPan=0;this.rollingStarted=false;
    // The shared context is armed by an explicit user gesture; do not swallow a suspended context.
  }
  private takeFree(pool:Voice[],atWall:number):Voice|null{
    for(const voice of pool)if(voice.endsAt<=atWall)return voice;
    return null;
  }
  private fire(voice:Voice,buffer:AudioBuffer,atWall:number,gain:number,pan:number,rate=1){
    const ctx=this.ctx!;
    const clamped=Math.max(-1,Math.min(1,pan));
    const source=ctx.createBufferSource();
    source.buffer=buffer;source.playbackRate.value=rate;
    const level=ctx.createGain();level.gain.value=gain;
    source.connect(level);level.connect(voice.left);level.connect(voice.right);
    const when=Math.max(ctx.currentTime+0.001,this.audioClock(atWall));
    voice.left.gain.setValueAtTime(Math.sqrt(0.5*(1-clamped)),when);
    voice.right.gain.setValueAtTime(Math.sqrt(0.5*(1+clamped)),when);
    source.start(when);
    voice.source=source;
    voice.endsAt=atWall+buffer.duration*1000/rate+40;
    this.played++;
    source.onended=()=>{try{source.disconnect();level.disconnect()}catch{}};
  }
  private audioClock(wall:number){return this.ctx?this.ctx.currentTime+(wall-now())/1000:0}
  /**
   * The native dispatches every impact whose scheduled time has passed, in scheduled order, in one
   * pass; the reserved voice pool reproduces that including the drop-when-full policy.
   */
  update(elapsed:number,rolling:RollingState){
    const audio=this.themeAudio;
    if(!this.ctx||!audio)return;
    const horizon=elapsed+0.20;
    while(this.impactCursor<this.impacts.length&&this.impacts[this.impactCursor].t<=horizon){
      const impact=this.impacts[this.impactCursor++];
      if(impact.t<elapsed-.12){this.dropped++;continue} // Never burst old collisions after tab suspension.
      const voice=this.takeFree(this.impactVoices,this.atWall+impact.t*1000);
      if(!voice){this.dropped++;continue}
      const buffer=audio.impacts[impact.surface===0?'die_on_ground':'die_on_die'][impact.strength];
      this.fire(voice,buffer,this.atWall+impact.t*1000,impact.gain*audio.mix.impact_gain,impact.pan);
    }
    // Rolling envelope: attack 24/s, release 9/s, started above 0.008 and stopped below 0.003.
    const target=rolling.activity*AUDIO_MAPPING.rollingMaximumVolume*audio.mix.rolling_gain;
    const dt=0.03;
    const rate=target>this.rollingVolume?24:9;
    this.rollingVolume+=(target-this.rollingVolume)*Math.max(0,Math.min(1,dt*rate));
    this.rollingPan+=(rolling.pan-this.rollingPan)*Math.max(0,Math.min(1,dt*12));
    const voice=this.rolling!;
    if(!this.rollingStarted&&this.rollingVolume>=0.008&&this.rollingBuffer){
      const ctx=this.ctx;
      const source=ctx.createBufferSource();
      source.buffer=this.rollingBuffer;source.loop=true;
      const level=ctx.createGain();level.gain.value=0;
      source.connect(level);level.connect(voice.left);level.connect(voice.right);
      voice.left.gain.value=Math.SQRT1_2;voice.right.gain.value=Math.SQRT1_2;
      source.start();
      voice.source=source;
      (voice as any).level=level;
      this.rollingStarted=true;
    }
    if(this.rollingStarted){
      const level=(voice as any).level as GainNode;
      level.gain.value=this.rollingVolume;
      voice.left.gain.value=Math.sqrt(0.5*(1-Math.max(-1,Math.min(1,this.rollingPan))));
      voice.right.gain.value=Math.sqrt(0.5*(1+Math.max(-1,Math.min(1,this.rollingPan))));
      if(target===0&&this.rollingVolume<0.003)this.stopRolling();
    }
  }
  private stopRolling(){
    const voice=this.rolling;
    if(!voice||!this.rollingStarted)return;
    try{voice.source?.stop()}catch{}
    try{voice.source?.disconnect();((voice as any).level as GainNode)?.disconnect()}catch{}
    voice.source=null;this.rollingStarted=false;this.rollingVolume=0;
  }
  /** One beam hit per die, at its reveal time; the modifier uses ordinal = dice count. */
  resultHit(ordinal:number,maximumFace:boolean){
    const audio=this.themeAudio;
    if(!this.ctx||!audio)return;
    const wall=now();
    const voice=this.takeFree(this.hitVoices,wall);
    if(!voice){this.dropped++;return}
    const buffer=audio.impacts.die_on_die[maximumFace?'heavy':'medium'];
    this.fire(voice,buffer,wall,resultHitGain(ordinal,maximumFace)*audio.mix.impact_gain,0,resultHitRate(ordinal));
  }
  emphasis(){
    const audio=this.themeAudio;
    if(!this.ctx||!audio)return;
    const voice=this.takeFree(this.impactVoices,now());
    if(!voice)return;
    this.fire(voice,audio.impacts.die_on_ground.light,now(),UI_EMPHASIS_GAIN*audio.mix.impact_gain,0);
  }
  /** Natural 20 wins a tie; the shipped configuration has no dramatic cue to override it. */
  stinger(naturalTwenty:boolean){
    const audio=this.themeAudio;
    if(!this.ctx||!audio)return;
    const voice=this.stingerVoice!;
    try{voice.source?.stop()}catch{}
    this.fire(voice,naturalTwenty?audio.natural_20:audio.natural_1,now(),audio.mix.stinger_gain,0);
  }
  /** Hard stop on interrupt: the native flushes voices rather than fading them out. */
  stop(_reason:string){
    for(const voice of [...this.impactVoices,...this.hitVoices,this.stingerVoice!]){
      if(!voice)continue;
      try{voice.source?.stop()}catch{}
      voice.source=null;voice.endsAt=0;
    }
    this.stopRolling();
    this.impacts=[];this.impactCursor=0;this.themeAudio=null;
  }
  /** Beam hits are scheduled by the cue, so the reservation has to see the projected end time. */
  reserveHit(ordinal:number,maximumFace:boolean,delaySeconds:number){
    const audio=this.themeAudio;
    if(!this.ctx||!audio)return;
    const wall=now()+delaySeconds*1000;
    const voice=this.takeFree(this.hitVoices,wall);
    if(!voice){this.dropped++;return}
    const buffer=audio.impacts.die_on_die[maximumFace?'heavy':'medium'];
    this.fire(voice,buffer,wall,resultHitGain(ordinal,maximumFace)*audio.mix.impact_gain,0,resultHitRate(ordinal));
  }
  reserveRule(kind:'max'|'min',pan:number,delaySeconds:number){
    if(!this.ctx||!this.themeAudio)return;
    const wall=now()+delaySeconds*1000,voice=this.takeFree(this.hitVoices,wall);
    if(!voice){this.dropped++;return;}
    let buffer=this.ruleBuffers.get(kind);if(!buffer){const samples=ruleSound(kind,this.ctx.sampleRate);buffer=this.ctx.createBuffer(1,samples.length,this.ctx.sampleRate);buffer.copyToChannel(samples,0);this.ruleBuffers.set(kind,buffer);}
    this.fire(voice,buffer,wall,.36*this.themeAudio.mix.impact_gain,pan);
  }
}
export const projectionPan=(projection:{width:number;height:number;pixelsPerDie:number},x:number,y:number,z:number)=>{
  const [sx]=N.projectVisual(projection as any,x,y,z);
  return Math.max(-1,Math.min(1,(sx/projection.width)*2-1));
};
