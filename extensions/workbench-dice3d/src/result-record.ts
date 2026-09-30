import type {ResultRecord} from './controller';
import {faceText} from './cue';
function element<K extends keyof HTMLElementTagNameMap>(tag:K,cls:string,value?:string){const el=document.createElement(tag);el.className=cls;if(value!==undefined)el.textContent=value;return el;}
export function resultCard(record:ResultRecord,reveal?:(id:string)=>void){
  const card=element('article','lab-result'+(record.secret&&!record.revealed?' is-secret':'')+(record.revealed?' is-revealed':''));card.dataset.roll=record.id;
  const header=element('header','lab-result-header'),name=element('b','lab-result-name',record.name);if(record.color)name.style.borderColor=record.color;
  header.append(name);if(record.secret)header.append(element('span','lab-result-scope',record.revealed?'已公开':'暗骰'));
  header.append(element('time','lab-result-time',new Date(record.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})));
  if(record.canReveal&&reveal){const button=element('button','lab-reveal','公开');button.title='公开并醒目：显示结果，不重新投掷';button.onclick=()=>reveal(record.id);header.append(button);}
  const line=element('div','lab-result-line');
  record.kinds.forEach((kind,i)=>{const chip=element('span','lab-result-die');chip.title=kind==='d_percentile'?'D% 十位骰':kind.toUpperCase();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',kind==='d4'?'M12 3 22 21H2Z':kind==='d6'?'M3 3H21V21H3Z':kind==='d8'?'M12 2 22 12 12 22 2 12Z':kind==='d10'||kind==='d_percentile'?'M12 2 22 9 18 21H6L2 9Z':'M12 2 22 8V17L12 23 2 17V8Z');svg.append(shape);
    chip.append(svg,element('b','',record.complete?faceText(kind,record.results[i]):'…'));line.append(chip);});
  if(record.modifier)line.append(element('b','lab-result-modifier',record.modifier>0?'+'+record.modifier:String(record.modifier)));
  const sum=element('span','lab-result-sum');sum.append(element('span','lab-result-equals','='),element('strong','lab-result-total',record.complete?String(record.total):'…'));line.append(sum);
  card.append(header,line);return card;
}
/** The permanent overlay remains mouse-through. Reveal is in the interactive popover history. */
export class ResultBubbles{
  readonly container=element('div','lab-bubbles');private items=new Map<string,{element:HTMLElement;timer:number}>();
  constructor(parent:HTMLElement){parent.append(this.container)}
  show(record:ResultRecord,highlight=false){
    const old=this.items.get(record.id);if(old){clearTimeout(old.timer);old.element.remove();this.items.delete(record.id)}
    const card=resultCard(record);if(highlight)card.classList.add('highlight');this.container.append(card);
    const timer=window.setTimeout(()=>{card.classList.add('leaving');setTimeout(()=>{card.remove();this.items.delete(record.id)},300)},12000);
    this.items.set(record.id,{element:card,timer});while(this.items.size>3){const [id,item]=this.items.entries().next().value!;clearTimeout(item.timer);item.element.remove();this.items.delete(id)}
  }
}
