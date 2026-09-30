import type {Catalog,Theme,ThemeID} from './types';
export type MaterialStyle='ceramic'|'metal'|'cat-eye'|'resin'|'sketch'|'comic'|'ink-flow'|'runic';
export const STYLE_CHOICES:{id:ThemeID;name:string;style:MaterialStyle}[]=[
  {id:'stage6_calibration',name:'瓷质',style:'ceramic'},
  {id:'brushed_metal',name:'拉丝金属',style:'metal'},
  {id:'godot_blue_cat_eye',name:'猫眼石',style:'cat-eye'},
  {id:'royal_ember_resin',name:'半透明树脂',style:'resin'},
  {id:'ink_sketch',name:'卡通涂鸦',style:'sketch'},
];
export const RETIRED_STYLES=['comic_print','flowing_ink','neon_runes'] as const;
export const STYLE_SETTINGS={
  ceramic:{code:0,roughness:.43,metalness:0,clearcoat:.25,clearcoatRoughness:.4,envMapIntensity:.32,specularIntensity:.38,opacity:1},
  metal:{code:1,roughness:.34,metalness:.92,clearcoat:0,clearcoatRoughness:.4,envMapIntensity:.72,specularIntensity:.8,opacity:1},
  'cat-eye':{code:2,roughness:.38,metalness:.06,clearcoat:.24,clearcoatRoughness:.4,envMapIntensity:.36,specularIntensity:.4,opacity:1},
  resin:{code:3,roughness:.30,metalness:0,clearcoat:.28,clearcoatRoughness:.38,envMapIntensity:.42,specularIntensity:.38,opacity:.56},
  sketch:{code:4,roughness:1,metalness:0,clearcoat:0,clearcoatRoughness:1,envMapIntensity:0,specularIntensity:0,opacity:1},
  comic:{code:5,roughness:1,metalness:0,clearcoat:0,clearcoatRoughness:1,envMapIntensity:0,specularIntensity:0,opacity:1},
  'ink-flow':{code:6,roughness:.94,metalness:0,clearcoat:0,clearcoatRoughness:1,envMapIntensity:.12,specularIntensity:.12,opacity:1},
  runic:{code:7,roughness:.65,metalness:.16,clearcoat:0,clearcoatRoughness:1,envMapIntensity:.20,specularIntensity:.18,opacity:1},
} as const;
/** Explicit runtime profiles reuse pinned glyphs/audio; source asset manifests are never rewritten. */
export function materialCatalog(source:Catalog):Catalog{
  const mapping:Record<ThemeID,ThemeID>={stage6_calibration:'stage6_calibration',godot_blue_cat_eye:'godot_blue_cat_eye',royal_ember_resin:'royal_ember_resin',brushed_metal:'stage6_calibration',ink_sketch:'stage6_calibration',comic_print:'stage6_calibration',flowing_ink:'stage6_calibration',neon_runes:'stage6_calibration'};
  const themes={} as Catalog['themes'];
  for(const choice of STYLE_CHOICES){const origin=source.themes[mapping[choice.id]];if(!origin)throw Error('缺少锁定材质源: '+mapping[choice.id]);
    // Product choice, not fallback: every style uses numeric 1/20, never ERROR / mascot art.
    themes[choice.id]={...origin,id:choice.id,name:choice.name,style:choice.style,
      masks:{...origin.masks,d20:source.themes.stage6_calibration.masks.d20}};}
  return{...source,themes};
}
export type RGB=[number,number,number];
export const linearChannel=(x:number)=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
export const luminance=(rgb:number[])=>rgb.reduce((sum,x,i)=>sum+linearChannel(x)*[.2126,.7152,.0722][i],0);
export const contrast=(a:number[],b:number[])=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
export function bodyRGB(theme:Theme,color?:string):RGB{return color?[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255) as RGB:theme.color.slice(0,3) as RGB}
export function lettering(body:number[],style:MaterialStyle='sketch'):{glyph:RGB;outline:RGB}{
  const light:RGB=[1,1,1],dark:RGB=[0,0,0];
  const bright=contrast(body,light)>=contrast(body,dark);
  if(style==='sketch'||style==='comic')return bright?{glyph:light,outline:dark}:{glyph:dark,outline:light};
  // Runic uses a dark, coloured stone substrate even for white/yellow player colours.
  // Its fixed pale engraving is also the colour of the result projectile, never rainbow cycling.
  if(style==='runic')return{glyph:body.map(x=>.90+x*.10) as RGB,outline:[.015,.020,.030]};
  const pigments:Record<Exclude<MaterialStyle,'sketch'|'comic'|'runic'>,{light:RGB;dark:RGB}>={
    ceramic:{light:[.95,.94,.91],dark:[.035,.047,.065]},
    metal:{light:[.89,.92,.96],dark:[.027,.033,.041]},
    'cat-eye':{light:[.98,.87,.59],dark:[.078,.047,.019]},
    resin:{light:[.94,.96,.98],dark:[.042,.058,.075]},
    'ink-flow':{light:[.97,.955,.92],dark:[.025,.032,.042]},
  };
  const extreme=bright?light:dark,pigment=bright?pigments[style].light:pigments[style].dark;
  let glyph=[...pigment] as RGB;
  // Mid-luminance room colours sometimes need slightly lighter/darker ink. Change the pigment
  // only as much as required, not every material to cartoon pure black / pure white.
  for(let step=1;contrast(body,glyph)<4.5&&step<=20;step++)glyph=pigment.map((x,i)=>x+(extreme[i]-x)*step/20) as RGB;
  return{glyph,outline:bright?dark:light};
}
/** Shared by the face and the result projectile. No natural-1/20 semantic recolouring. */
export function presentationTheme(theme:Theme,color?:string):Theme{
  const {glyph}=lettering(bodyRGB(theme,color),theme.style);return{...theme,glyph,naturalOne:glyph,naturalTwenty:glyph};
}
