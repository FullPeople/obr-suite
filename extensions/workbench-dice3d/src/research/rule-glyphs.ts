import type {Kind} from '../types';
import type {ClampEpisode} from './rule-timeline';
import {RULE_GLYPH_LAYOUTS} from '../glyph-layouts';

export interface GlyphPatch{center:[number,number];size:[number,number];angle:number}
/** UV regions, not floating decals. D4 updates all three labels belonging to its upward vertex. */
export function ruleGlyphPatches(kind:Kind,raw:number):GlyphPatch[]{
  const layout=RULE_GLYPH_LAYOUTS.find(l=>l.kind===kind);if(!layout)throw Error('缺少规则数字 UV 合同: '+kind);
  const source=kind==='d10'&&raw===10?0:raw;
  const patches:GlyphPatch[]=[];
  for(const f of layout.faces){
    const [left,top,right,bottom]=f.bounds,w=right-left,h=bottom-top;
    const u=f.polygon.reduce((s,p)=>s+p[0],0)/f.polygon.length,v=f.polygon.reduce((s,p)=>s+p[1],0)/f.polygon.length;
    if(kind==='d4'){
      for(const label of f.labels)if(label.value===source){const dx=label.uv[0]-u,dy=label.uv[1]-v;
        patches.push({center:[left+(u+dx*.5)*w,top+(v+dy*.5)*h],size:[w*.30,h*.30],angle:Math.atan2(dx,-dy)});
      }
    }else if(f.value===source){
      const ratio=kind==='d20'?.52:.64;patches.push({center:[left+u*w,top+v*h],size:[w*ratio,h*ratio],angle:0});
    }
  }
  if(patches.length!==(kind==='d4'?3:1))throw Error('规则数字 UV 目标不唯一: '+kind+' '+raw);
  return patches;
}
export function landedRuleValue(raw:number,episodes:ClampEpisode[],age:number){
  let value=raw;for(const e of episodes)if(age>=e.land)value=e.to;return value;
}
// Kept as pure, read-only asset/temporal audit helpers. Runtime no longer replaces ANY glyph.
