import {assetUrl} from '../../asset-base';
// Preserve old bookmarks while retiring the old editor and XLSX importer.
const query=new URLSearchParams(location.search),room=query.get('room'),card=query.get('card');
const language=query.get('lang')==='en'?'en':'zh';
const target=query.get('data_url')||(room&&card?`https://obr.dnd.center/characters/${encodeURIComponent(room)}/${encodeURIComponent(card)}/data.json`:query.get('preview')==='sample'?assetUrl(language==='en'?'cc-example-card.en.json':'cc-example-card.json'):undefined);
if(target){
 const params=new URLSearchParams({legacyViewer:'1',lang:language,data_url:target});
 location.replace(`${assetUrl('card-viewer/index.html')}?${params}`);
}else{
 const app=document.getElementById('app');
 if(app)app.innerHTML='<div class="cc-loading">请从角色卡列表重新打开。旧版编辑与 XLSX 导入已停用。<br><a href="https://obr.dnd.center/card/" target="_blank" rel="noopener">前往角色卡网站</a></div>';
}
