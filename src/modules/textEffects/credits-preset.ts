import type {TextEffectConfig} from './model';

/** A separate preset using the existing synchronized, stoppable text renderer. */
export function creditsPreset(base:TextEffectConfig):TextEffectConfig {
 return {...base,
  title:'本次冒险',subtitle:'THANK YOU FOR PLAYING',
  body:[
   '地下城主','主持人姓名','',
   '冒险者','玩家一 · 角色姓名','玩家二 · 角色姓名','玩家三 · 角色姓名','玩家四 · 角色姓名','',
   '模组与故事','模组名称 / 作者','',
   '地图与美术','创作者姓名','',
   '音乐与音效','创作者姓名','',
   '特别感谢','每一位共同讲述故事的人','',
   '我们的故事，未完待续。',
  ].join('\n'),
  font:'serif',size:6,weight:600,spacing:18,color:'#ffffff',accent:'#ffffff',
  subtitleSize:.25,subtitleSpacing:38,subtitleGap:.38,subtitleWeight:400,subtitleColor:'#d1d1d1',
  background:'solid',backgroundColor:'#000000',opacity:1,backgroundSync:true,
  decoration:'none',shadow:false,outline:0,outerOutline:0,glow:0,fill:'solid',
  writing:'horizontal',align:'center',anchor:'center-center',marginX:8,marginY:6,offsetX:0,offsetY:0,
  entry:'fade',leave:'fade',idle:'none',sequence:'parallel',entryStagger:0,exitStagger:0,
  subtitleEffect:'fade',subtitleDelay:0,enter:800,hold:1000,exit:900,startDelay:300,endDelay:500,
  flow:'scroll',scrollSpeed:36,scrollFade:true,bodySize:3.3,lineHeight:1.75,pageSplit:false,wrapChars:24,cursor:false,
 };
}
