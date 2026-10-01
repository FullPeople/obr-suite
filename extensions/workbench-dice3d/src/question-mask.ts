import * as T from 'three';
import {glyphTexture} from './glyph-texture';
import type {Kind} from './types';
import {RULE_GLYPH_LAYOUTS} from './glyph-layouts';
/** Full atlas replacement, not a floating decal: EVERY original number is absent. Tetrahedra
 * retain three upright-at-their-corner question marks per face; D% no longer leaks tens. */
export function questionMask(kind:Kind):T.DataTexture{
  const layout=RULE_GLYPH_LAYOUTS.find(l=>l.kind===kind);if(!layout)throw Error('缺少问号字形布局: '+kind);
  const size=2048,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('不能创建暗骰问号图集');
  ctx.fillStyle='#000';ctx.fillRect(0,0,size,size);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
  for(const f of layout.faces){const [left,top,right,bottom]=f.bounds,w=right-left,h=bottom-top;
    const u=f.polygon.reduce((s,p)=>s+p[0],0)/f.polygon.length,v=f.polygon.reduce((s,p)=>s+p[1],0)/f.polygon.length;
    const slots=kind==='d4'?f.labels.map(label=>({u:u+(label.uv[0]-u)*.5,v:v+(label.uv[1]-v)*.5,angle:Math.atan2(label.uv[0]-u,-(label.uv[1]-v)),ratio:.29})):[{u,v,angle:0,ratio:kind==='d20'?.50:.62}];
    for(const slot of slots){ctx.save();ctx.translate((left+slot.u*w)*size,(top+slot.v*h)*size);ctx.rotate(slot.angle);
      ctx.font=`650 ${Math.round(Math.min(w,h)*size*slot.ratio)}px CinzelVariable`;ctx.fillText('?',0,0);ctx.restore();}
  }
  const texture=glyphTexture(canvas);canvas.width=canvas.height=1;texture.name='question-only-'+kind;return texture;
}
