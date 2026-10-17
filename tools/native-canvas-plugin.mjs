import {NATIVE_CANVAS_PAGES} from '../src/native-canvas.ts';
export const NATIVE_CANVAS_BOOT=`(function(){var s=document.documentElement.style;s.setProperty('color-scheme',location.pathname.endsWith('-native.html')?'normal':'light dark','important');s.setProperty('background','transparent','important')})();`;
/** Native aliases share the exact original application modules and asset graph.
 * The tiny head policy runs before paint; no SDK handshake or theme RPC gates it. */
export function nativeCanvasPlugin(){return {
 name:'native-canvas-contract',enforce:'post',
 transformIndexHtml:{order:'post',handler(html,context){const name=context.filename?.replaceAll('\\','/').split('/').pop();if(!NATIVE_CANVAS_PAGES.includes(name))return html;return {html,tags:[{tag:'script',attrs:{'data-native-canvas':''},children:NATIVE_CANVAS_BOOT,injectTo:'head-prepend'}]};}},
 configureServer(server){server.middlewares.use((request,_response,next)=>{const path=request.url?.split('?')[0],original=path?.replace(/-native\.html$/,'.html');if(path!==original&&NATIVE_CANVAS_PAGES.includes(original?.split('/').pop()))request.url=original+(request.url.includes('?')?'?'+request.url.split('?').slice(1).join('?'):'');next();});},
 generateBundle:{order:'post',handler(_options,bundle){for(const name of NATIVE_CANVAS_PAGES){const original=bundle[name];if(!original)continue;this.emitFile({type:'asset',fileName:name.replace(/\.html$/,'-native.html'),source:original.source});}}}
};}
