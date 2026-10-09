import { FONTS, duration, entryTime, narrationTime, type TextEffectConfig } from './model';
import { BLOCK_EFFECTS, clamp, entrance, departure, holding, neutral, noise, stagger, type Pose, type MotionContext } from './motion';
import './renderer.css';
const element = (tag:string, classes:string, text?:string) => { const node=document.createElement(tag);node.className=classes;if(text!==undefined)node.textContent=text;return node; };
const rgba=(hex:string,a:number)=>`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
const splitter = new Intl.Segmenter(undefined,{granularity:'grapheme'});
const letters=(text:string)=>Array.from(splitter.segment(text),item=>item.segment);
interface Glyph {el:HTMLElement;ink:HTMLElement;index:number;x:number;y:number;line:number;size:number;seed:number;cache:string}
interface Group {root:HTMLElement;glyphs:Glyph[];kind:'title'|'subtitle'|'body';size:number;lines:number;seed:number}
export interface RenderOptions {startsAt?:number;reduced?:boolean;time?:number;onComplete?:()=>void;onFrame?:(elapsed:number,total:number)=>void}
export function renderEffect(root:HTMLElement,c:TextEffectConfig,options:RenderOptions={}) {
 root.replaceChildren();
 const stage=element('div',`te-stage te-${c.background}`),background=element('div','te-background'),ornament=element('div',`te-ornament te-${options.reduced?'none':c.decoration}`),motion=element('div','te-motion'),title=element('div','te-title'),subtitle=element('div','te-subtitle'),bodyWindow=element('div','te-body-window'),body=element('div','te-body'),solo=element('div','te-solo'),cursor=element('i','te-cursor');
 solo.setAttribute('aria-hidden','true');cursor.setAttribute('aria-hidden','true');bodyWindow.append(body);motion.append(title,subtitle,bodyWindow);stage.append(background,ornament,motion,solo,cursor);root.append(stage);
 const vars:Record<string,string>={color:c.color,accent:c.accent,bg:c.backgroundColor,font:FONTS[c.font],outline:`${c.outline}px`, 'outline-color':c.outlineColor,'outer-outline':`${c.outline+c.outerOutline*2}px`,'outer-color':c.outerOutlineColor,glow:`${c.glow}px`,'glow-color':c.glowColor,'glow-strength':String(c.glowStrength),'fill-opacity':String(c.fillOpacity),'glitch-one':c.glitchColor,'glitch-two':c.glitchColor2,'shadow':c.shadow?`${c.shadowX}px ${c.shadowY}px ${c.shadowBlur}px ${rgba(c.shadowColor,c.shadowOpacity)}`:'0 0 0 transparent','deco-fill':c.decorationColor,'deco-line':c.decorationLineColor,'deco-width':`${c.decorationThickness}px`,'deco-radius':`${c.decorationRadius}em`,'tape-color':c.decorationLineColor,'tape-stripe':c.tapeStripe};
 vars.color=rgba(c.color,c.fillOpacity);
 for(const[key,value]of Object.entries(vars))stage.style.setProperty('--te-'+key,value);
 stage.style.setProperty('--te-outer-opacity',c.outerOutline?'1':'0');
 stage.style.fontWeight=String(c.weight);stage.style.fontStyle=c.italic?'italic':'normal';stage.dataset.writing=c.writing;stage.dataset.anchor=c.anchor;
 motion.style.textAlign=c.align;motion.style.writingMode=c.writing==='vertical'?'vertical-rl':'horizontal-tb';
 title.hidden=!c.title;subtitle.hidden=!c.subtitle;bodyWindow.hidden=!c.body;
 title.style.letterSpacing=`${c.spacing/100}em`;title.style.lineHeight=String(c.lineHeight);
 subtitle.style.fontFamily=c.subtitleFont==='same'?FONTS[c.font]:FONTS[c.subtitleFont as keyof typeof FONTS];subtitle.style.fontWeight=String(c.subtitleWeight);subtitle.style.fontStyle=c.subtitleItalic?'italic':'normal';subtitle.style.letterSpacing=`${c.subtitleSpacing/100}em`;subtitle.style.setProperty('--te-color',rgba(c.subtitleColor,c.fillOpacity));subtitle.style.setProperty('--te-outline','0px');subtitle.style.setProperty('--te-outer-outline','0px');
 subtitle.style.order=c.subtitlePosition==='above'?'-1':'0';body.style.lineHeight=String(c.lineHeight);cursor.style.background=c.cursorColor;
 const gradients=[c.color,c.color2,...(c.thirdColor?[c.color3]:[])].map(color=>rgba(color,c.fillOpacity)).join(',');
 const groups:Group[]=[{root:title,glyphs:[],kind:'title',size:0,lines:0,seed:311},{root:subtitle,glyphs:[],kind:'subtitle',size:0,lines:0,seed:701},{root:body,glyphs:[],kind:'body',size:0,lines:0,seed:1103}];
 const particles=c.decoration==='sparks'?Array.from({length:20},(_,i)=>{const dot=element('i','te-particle');dot.style.left=`${noise(i+63)*100}%`;dot.style.top=`${noise(i+227)*100}%`;ornament.append(dot);return dot;}):[];
 if(['tape','corners'].includes(c.decoration))for(let i=0;i<(c.decoration==='corners'?4:2);i++)ornament.append(element('i',`te-deco-part te-part-${i}`));
 let frame=0,disposed=false,pages=[c.body],pageWeights=[1],currentPage=-1,lastTime=0,stageWidth=0,stageHeight=0,availableHeight=0,availableWidth=0,bodySchedule:number[]=[],scheduleTotal=0,scrolling=false;
 let snapshot=options.time===undefined&&options.startsAt===undefined;
 const flow=options.reduced?'all':c.flow,total=duration(c),arrive=entryTime(c),revealTime=narrationTime(c),exitAt=c.startDelay+arrive+revealTime+c.hold;
 const build=(group:Group,text:string)=>{group.root.replaceChildren();group.glyphs=[];let index=0;for(const letter of letters(text)){if(letter==='\n'){group.root.append(document.createElement('br'));continue;}const glyph=element('span','te-glyph'),ink=element('span','te-ink',letter);glyph.dataset.letter=letter;ink.dataset.letter=letter;glyph.append(ink);group.root.append(glyph);group.glyphs.push({el:glyph,ink,index:index++,x:0,y:0,line:0,size:group.size,seed:group.seed+index*29,cache:''});}group.root.dataset.glyphs=String(group.glyphs.length);};
 const geometry=(group:Group)=>{const rect=group.root.getBoundingClientRect(),linePositions:number[]=[];for(const glyph of group.glyphs){const box=glyph.el.getBoundingClientRect(),position=c.writing==='vertical'?box.left:box.top;let line=linePositions.findIndex(value=>Math.abs(value-position)<2);if(line<0){line=linePositions.length;linePositions.push(position);}glyph.x=box.left+box.width/2-rect.left-rect.width/2;glyph.y=box.top+box.height/2-rect.top-rect.height/2;glyph.line=line;glyph.size=group.size;glyph.cache='';if(c.fill==='gradient'&&group.kind!=='subtitle'){glyph.ink.style.backgroundImage=`linear-gradient(${c.gradientDirection==='horizontal'?'90deg':c.gradientDirection==='diagonal'?'135deg':'180deg'},${gradients})`;glyph.ink.style.color='transparent';glyph.ink.style.webkitTextFillColor='transparent';if(c.gradientDirection!=='vertical'){glyph.ink.style.backgroundSize=`${rect.width}px ${rect.height}px`;glyph.ink.style.backgroundPosition=`${rect.left-box.left}px ${rect.top-box.top}px`;}}}group.lines=Math.max(1,linePositions.length);};
 const setPage=(index:number)=>{if(index===currentPage)return;currentPage=index;build(groups[2],pages[index]);const previous=motion.style.transform;motion.style.transform='none';geometry(groups[2]);motion.style.transform=previous;bodySchedule=[];scheduleTotal=0;for(const glyph of groups[2].glyphs){if(glyph.index&&glyph.line!==groups[2].glyphs[glyph.index-1].line)scheduleTotal+=c.linePause;bodySchedule.push(scheduleTotal);const letter=glyph.ink.textContent||'';scheduleTotal+=1000/c.cps+(/[，。！？、,.!?;；：:]/.test(letter)?c.punctPause:0);}scheduleTotal=Math.max(1,scheduleTotal);};
 const layout=()=>{
  if(disposed)return;stageWidth=stage.clientWidth;stageHeight=stage.clientHeight;
  const mx=stageWidth*c.marginX/100,my=stageHeight*c.marginY/100;stage.style.padding=`${my}px ${mx}px`;
  const[v,h]=c.anchor.split('-');stage.style.alignItems=v==='top'?'flex-start':v==='bottom'?'flex-end':'center';stage.style.justifyContent=h==='left'?'flex-start':h==='right'?'flex-end':'center';
  motion.style.transform='none';motion.style.filter='none';motion.style.clipPath='none';motion.style.maxHeight=`${Math.max(16,stageHeight-my*2)}px`;motion.style.maxWidth=`${Math.max(16,stageWidth-mx*2)}px`;
  stage.style.setProperty('--te-offset-x',`${stageWidth*c.offsetX/100}px`);stage.style.setProperty('--te-offset-y',`${stageHeight*c.offsetY/100}px`);
  groups[0].size=stageWidth*c.size/100;groups[1].size=groups[0].size*c.subtitleSize;groups[2].size=stageWidth*c.bodySize/100;
  title.textContent=c.title;subtitle.textContent=c.subtitle;body.textContent=c.body?'中':'';bodyWindow.style.height='auto';bodyWindow.style.maxHeight='none';
  body.style.fontSize=`${groups[2].size}px`;body.style.maxWidth=c.writing==='horizontal'&&c.wrapChars?`${c.wrapChars}em`:'none';body.style.maxHeight=c.writing==='vertical'&&c.wrapChars?`${c.wrapChars}em`:'none';
  for(let attempt=0;attempt<15;attempt++){title.style.fontSize=`${groups[0].size}px`;subtitle.style.fontSize=`${groups[1].size}px`;subtitle.style.marginBlockStart=c.subtitlePosition==='below'?`${groups[0].size*c.subtitleGap}px`:'0';subtitle.style.marginBlockEnd=c.subtitlePosition==='above'?`${groups[0].size*c.subtitleGap}px`:'0';if(motion.scrollHeight<=motion.clientHeight+1&&motion.scrollWidth<=motion.clientWidth+1)break;groups[0].size*=.86;groups[1].size*=.86;}
  const vertical=c.writing==='vertical';
  availableHeight=Math.max(16,stageHeight-my*2-(vertical?0:(title.hidden?0:title.offsetHeight)+(subtitle.hidden?0:subtitle.offsetHeight+groups[0].size*c.subtitleGap))-(vertical?0:groups[2].size*.7));
  availableWidth=Math.max(16,stageWidth-mx*2-(vertical?(title.hidden?0:title.offsetWidth)+(subtitle.hidden?0:subtitle.offsetWidth+groups[0].size*c.subtitleGap)+groups[2].size*.7:0));
  bodyWindow.style.maxHeight=`${availableHeight}px`;bodyWindow.style.maxWidth=`${availableWidth}px`;bodyWindow.style.width='auto';scrolling=flow==='scroll';
  if(vertical)body.style.height=`${Math.min(availableHeight,c.wrapChars?groups[2].size*c.wrapChars:availableHeight)}px`;
  pages=[];
  if(scrolling)pages=[c.body];else for(const paragraph of(c.pageSplit?c.body.split(/\n\s*\n/):[c.body])){const chars=letters(paragraph);if(!chars.length){if(pages.length)pages.push('');continue;}for(let at=0;at<chars.length;){let lo=1,hi=chars.length-at,fit=1;while(lo<=hi){const mid=Math.floor((lo+hi)/2);body.textContent=chars.slice(at,at+mid).join('');if(body.scrollHeight<=availableHeight+1&&body.scrollWidth<=availableWidth+1){fit=mid;lo=mid+1;}else hi=mid-1;}pages.push(chars.slice(at,at+fit).join(''));at+=fit;}}
  if(!pages.length)pages=[''];const weightSum=pages.reduce((sum,text)=>sum+Math.max(1,letters(text).length),0);pageWeights=pages.map(text=>Math.max(1,letters(text).length)/weightSum);root.dataset.pages=String(pages.length);
  if(scrolling){bodyWindow.style.height=`${availableHeight}px`;if(vertical)bodyWindow.style.width=`${availableWidth}px`;}
  bodyWindow.style.maskImage=scrolling&&c.scrollFade?`linear-gradient(${vertical?'to right,':''}transparent,#000 12%,#000 88%,transparent)`:'none';
  build(groups[0],c.title);build(groups[1],c.subtitle);geometry(groups[0]);geometry(groups[1]);currentPage=-1;setPage(0);
  const bounds=motion.getBoundingClientRect(),stageRect=stage.getBoundingClientRect();let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const group of groups){if(group.root.hidden||group.kind==='body'&&(!c.body||scrolling))continue;for(const glyph of group.glyphs){const box=glyph.el.getBoundingClientRect();left=Math.min(left,box.left);right=Math.max(right,box.right);top=Math.min(top,box.top);bottom=Math.max(bottom,box.bottom);}}
  if(!Number.isFinite(left)){left=bounds.left;right=bounds.right;top=bounds.top;bottom=bounds.bottom;}
  const pad=groups[0].size*c.decorationPadding,extension=groups[0].size*c.decorationExtend;
  if(!['none','rays','mist','sparks','rings'].includes(c.decoration)){ornament.style.inset='auto';ornament.style.left=`Math.max(0,left-stageRect.left-pad-(c.decoration==='frame'?extension:0))}px`;ornament.style.top=`Math.max(0,top-stageRect.top-pad)}px`;ornament.style.width=`${Math.min(stageWidth,right-left+2*pad+(c.decoration==='frame'?2*extension:0))}px`;ornament.style.height=`${bottom-top+2*pad}px`;ornament.style.fontSize=`${groups[0].size}px`;ornament.style.setProperty('--te-deco-extend',`${extension}px`);}
  ornament.style.setProperty('--te-tape-size',`${c.tapeWidth*stageWidth/640}px`);ornament.style.setProperty('--te-deco-soft',`${c.decorationSoftness*groups[0].size*.3}px`);ornament.style.setProperty('--te-deco-fade',`${c.decorationFade*50}%`);
  if(c.decorationOutline)ornament.style.filter=`drop-shadow(0 0 ${c.outline+c.outerOutline}px ${c.outlineColor})`;
  draw(lastTime);
 };
 const context=(group:Group,index=0):MotionContext=>({size:group.size,x:0,y:0,index,count:group.glyphs.length,seed:group.seed+index*29,power:1,direction:'left',ease:'auto'});
 const paint=(node:HTMLElement,pose:Pose,cache?:Glyph)=>{
  const transform=`translate3d(${pose.x.toFixed(2)}px,${pose.y.toFixed(2)}px,0) rotate(${pose.rotation.toFixed(2)}deg) perspective(500px) rotateY(${pose.flip.toFixed(2)}deg) rotateX(${pose.tilt.toFixed(2)}deg) scale(${(pose.scale*pose.sx).toFixed(4)},${(pose.scale*pose.sy).toFixed(4)})`, signature=transform+pose.opacity.toFixed(3)+pose.blur.toFixed(2)+pose.brightness.toFixed(2)+pose.glow.toFixed(2)+pose.glitch.toFixed(2)+pose.clip;
  if(cache?.cache===signature)return;if(cache)cache.cache=signature;node.style.transform=transform;node.style.opacity=String(clamp(pose.opacity));node.style.filter=pose.blur>.01||Math.abs(pose.brightness-1)>.01?`blur(${Math.max(0,pose.blur)}px) brightness(${Math.max(.1,pose.brightness)})`:'none';node.style.clipPath=pose.clip||'none';node.style.setProperty('--te-pulse-glow',String(pose.glow));node.style.setProperty('--te-glitch',String(pose.glitch));node.style.setProperty('--te-glitch-shift',`${Math.round(pose.glitch*7)}px`);
 };
 function draw(raw:number){
  if(disposed)return;lastTime=clamp(raw,0,total);const t=lastTime-c.startDelay,exitProgress=c.exit?clamp((lastTime-exitAt)/c.exit):lastTime>=exitAt?1:0,enterProgress=c.enter?clamp(t/c.enter):1;
  stage.style.visibility=raw<0||t<0||lastTime>=total-c.endDelay&&c.endDelay>0?'hidden':'visible';root.dataset.phase=t<arrive?'entry':lastTime<exitAt?'hold':'exit';
  const fade=lastTime>=exitAt?1-exitProgress:clamp(t/Math.max(1,c.enter));background.style.opacity=String(c.opacity*(c.backgroundSync?fade:1));
  let segmentStart=0,pageIndex=0,segmentLength=revealTime+c.hold;
  const sectionTime=clamp(t-arrive,0,segmentLength);
  while(pageIndex<pages.length-1&&sectionTime>=segmentStart+segmentLength*pageWeights[pageIndex]){segmentStart+=segmentLength*pageWeights[pageIndex];pageIndex++;}
  if(snapshot){pageIndex=0;segmentStart=0;}
  setPage(pageIndex);const localTime=Math.max(0,sectionTime-segmentStart),slot=segmentLength*pageWeights[pageIndex],revealSlot=revealTime*pageWeights[pageIndex],bodyProgress=snapshot?1:revealSlot?clamp(localTime/revealSlot):1,gap=Math.min(c.pageGap,Math.max(0,(slot-revealSlot)*.4));
  const entryEffect=options.reduced?'fade':c.entry,exitEffect=options.reduced?'fade':c.leave,idleEffect=options.reduced?'none':c.idle;
  let block=neutral();const blockContext={...context(groups[0]),power:c.entryPower,direction:c.entryDirection,ease:c.entryEase};
  if(t<c.enter&&BLOCK_EFFECTS.has(entryEffect))block=entrance(entryEffect,enterProgress,blockContext);
  else if(lastTime>=exitAt&&BLOCK_EFFECTS.has(exitEffect))block=departure(exitEffect,exitProgress,{...blockContext,power:c.exitPower,direction:c.exitDirection,ease:c.exitEase});
  else if(t>=arrive&&lastTime<exitAt&&!['wave','shake','glow'].includes(idleEffect))block=holding(idleEffect,t-arrive,{...blockContext,power:c.idlePower});
  block.x+=stageWidth*c.offsetX/100;block.y+=stageHeight*c.offsetY/100;paint(motion,block);
  let lastVisible:Glyph|undefined;
  for(const group of groups){if(group.root.hidden)continue;const effect=group.kind==='subtitle'&&c.subtitleEffect!=='same'&&!options.reduced?c.subtitleEffect:entryEffect;
   const p=c.enter?clamp((t-(group.kind==='subtitle'?Math.max(-c.startDelay,c.subtitleDelay):0))/c.enter):1;
   for(const glyph of group.glyphs){
    const ctx={...context(group,glyph.index),x:glyph.x,y:glyph.y,power:c.entryPower,direction:c.writing==='vertical'&&effect==='tracking'?'vertical':c.entryDirection,ease:c.entryEase};let pose=neutral();
    if(group.kind==='body'&&scrolling){if(glyph.cache!=='scroll-static'){paint(glyph.el,neutral(),glyph);for(const key of ['--te-glitch','--te-glitch-shift','--te-pulse-glow'])glyph.el.style.setProperty(key,'inherit');glyph.cache='scroll-static';}continue;}
    if(p<1&&!BLOCK_EFFECTS.has(effect))pose=entrance(effect,stagger(p,glyph.index,group.glyphs.length,c.entryOrder,effect==='typewriter'?Math.max(.8,c.entryStagger):c.entryStagger),ctx);
    else if(lastTime>=exitAt&&!BLOCK_EFFECTS.has(exitEffect))pose=departure(exitEffect,stagger(exitProgress,glyph.index,group.glyphs.length,c.exitOrder,exitEffect==='erase'?Math.max(.8,c.exitStagger):c.exitStagger),{...ctx,power:c.exitPower,direction:c.writing==='vertical'&&exitEffect==='tracking'?'vertical':c.exitDirection,ease:c.exitEase});
    else if(t>=arrive&&lastTime<exitAt&&['wave','shake','glow'].includes(idleEffect))pose=holding(idleEffect,t-arrive,{...ctx,power:c.idlePower});
    if(group.kind==='body'&&!scrolling){
     if(t<arrive&&flow!=='all')pose.opacity=0;
     if(flow==='char'&&bodyProgress<1){const clock=bodyProgress*(scheduleTotal+Math.min(c.enter,500));pose=entrance(effect,clamp((clock-bodySchedule[glyph.index])/Math.max(1,Math.min(c.enter,500))),ctx);}
     else if(['line','sweep'].includes(flow)&&bodyProgress<1){const lineP=bodyProgress*(group.lines+1)-glyph.line,within=flow==='sweep'?(c.writing==='vertical'?glyph.y/group.root.clientHeight+.5:glyph.x/group.root.clientWidth+.5):0;pose=entrance(effect,clamp(lineP-within),ctx);}
     else if(flow==='spread'&&bodyProgress<1){const spread=clamp((bodyProgress*(c.spreadHold+c.spreadTime)-c.spreadHold)/c.spreadTime);pose.x=-glyph.x*(1-easingSpread(spread));pose.y=-glyph.y*(1-easingSpread(spread));pose.opacity=t>=arrive?1:0;}
     else if(flow==='solo'&&bodyProgress<1)pose.opacity=0;
     else if(flow==='all'&&pageIndex>0&&localTime<Math.min(c.enter,slot*.2))pose=entrance(effect,localTime/Math.max(1,Math.min(c.enter,slot*.2)),ctx);
     if(!snapshot&&pageIndex<pages.length-1&&localTime>slot-gap)pose.opacity=0;
     if(pose.opacity>.5)lastVisible=glyph;
    }
    pose.glitch=Math.max(pose.glitch,block.glitch);pose.glow*=block.glow;
    paint(glyph.el,pose,glyph);
   }
  }
  if(scrolling){body.style.transform=c.writing==='vertical'?`translateX(${-availableWidth+(body.scrollWidth+availableWidth)*bodyProgress}px)`:`translateY(${availableHeight-(body.scrollHeight+availableHeight)*bodyProgress}px)`;body.style.opacity=String(lastTime>=exitAt?1-exitProgress:1);}else{body.style.transform='none';body.style.opacity='1';}
  const soloClock=bodyProgress*(groups[2].glyphs.length/c.cps*1000+c.soloPause);
  solo.hidden=flow!=='solo'||bodyProgress>=1||t<arrive||!c.body||soloClock>=groups[2].glyphs.length/c.cps*1000;
  if(!solo.hidden){const glyphs=groups[2].glyphs,index=Math.min(glyphs.length-1,Math.floor(soloClock/1000*c.cps));solo.textContent=glyphs[index]?.ink.textContent||'';solo.style.fontSize=`${Math.min(stageWidth,stageHeight)*c.soloSize}px`;solo.style.transform=`scale(${1+(1-(bodyProgress*glyphs.length)%1)*.12*c.soloImpact})`;}
  cursor.hidden=!c.cursor||flow!=='char'||bodyProgress>=1||!lastVisible||options.reduced===true;
  if(!cursor.hidden&&lastVisible){const box=lastVisible.el.getBoundingClientRect(),stageRect=stage.getBoundingClientRect();cursor.style.left=`${box.right-stageRect.left+2}px`;cursor.style.top=`${box.top-stageRect.top}px`;cursor.style.height=`${box.height}px`;cursor.style.opacity=Math.floor(lastTime/400)%2?'0':'1';}
  const decoEntry=options.reduced?clamp(t/Math.max(1,c.enter)):c.decorationAnimation==='none'?1:clamp(t/c.decorationTime),decoFade=c.decorationAnimation==='fade'?decoEntry:1;ornament.style.opacity=String(c.decorationOpacity*(lastTime>=exitAt?1-exitProgress:1)*decoFade);let decorTransform='none';
  if(c.decorationAnimation==='grow'&&!options.reduced)decorTransform=`scaleX(${decoEntry})`;
  if(c.decoration==='rays'&&!options.reduced)decorTransform=`rotate(${lastTime*.002}deg) scale(${.9+clamp(t/total)*.2})`;
  if(c.decoration==='mist'&&!options.reduced)decorTransform=`translate(${Math.sin(lastTime/2400)*3}%,${Math.cos(lastTime/2900)*2}%)`;
  if(c.decoration==='rings'&&!options.reduced)decorTransform=`scale(${1+Math.sin(lastTime/1200)*.035})`;
  ornament.style.transform=decorTransform;
  if(c.decoration==='tape'){ornament.style.setProperty('--te-tape-offset',`${options.reduced?0:lastTime/1000*c.tapeSpeed*stageWidth/640}px`);if(c.tapeBlink&&!options.reduced)ornament.style.opacity=String(c.decorationOpacity*(lastTime>=exitAt?1-exitProgress:1)*(1-c.tapeBlink*.5*(1+Math.sin(lastTime/130))));}
  for(const[i,dot]of particles.entries()){dot.style.transform=`translateY(${options.reduced?0:-lastTime/1000*(4+noise(i+8)*12)}px)`;dot.style.opacity=String(.25+noise(i+41,Math.floor(lastTime/250))*.75);}
  options.onFrame?.(lastTime,total);
 }
 const easingSpread=(p:number)=>p*p*(3-2*p);
 lastTime=options.time??c.startDelay+arrive+revealTime;layout();const resize=new ResizeObserver(layout);resize.observe(stage);
 const dispose=()=>{if(disposed)return;disposed=true;resize.disconnect();cancelAnimationFrame(frame);if(stage.parentElement===root)stage.remove();};
 if(options.startsAt!==undefined){const tick=()=>{if(disposed)return;const elapsed=Date.now()-options.startsAt!;draw(elapsed);if(elapsed>=total){dispose();options.onComplete?.();}else frame=requestAnimationFrame(tick);};tick();}
 return {dispose,seek:(time:number)=>{snapshot=false;draw(time);}};
}
