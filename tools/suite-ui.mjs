// Shared UI layer for every html entry: the design-token stylesheet
// (src/styles/suite-ui.css) plus a tiny boot script that applies the saved
// colour preset (`full-suite/ui-theme`) before first paint and follows
// changes made in another popover through the `storage` event.
//
// Used by vite.config.ts (transformIndexHtml, dev server + build) and by
// tools/build-workbench-panels.mjs for the detached workbench panels.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const SUITE_UI_CSS_PATH=resolve(root,'src/styles/suite-ui.css');
export const SUITE_THEME_KEY='full-suite/ui-theme';
export const SUITE_UI_BOOT=`(function(){var k='${SUITE_THEME_KEY}',ok={night:1,graphite:1,parchment:1,celadon:1};function a(){var t='night';try{t=localStorage.getItem(k)||'night'}catch(e){}if(!ok[t])t='night';document.documentElement.setAttribute('data-suite-theme',t)}a();window.addEventListener('storage',function(e){if(!e.key||e.key===k)a()})})();`;

export function suiteUiCss(){return readFileSync(SUITE_UI_CSS_PATH,'utf8');}
/** Raw <head> markup for builds that splice html by hand. */
export function suiteUiHead(){return `<style data-suite-ui>${suiteUiCss()}</style><script data-suite-ui-boot>${SUITE_UI_BOOT}</script>`;}
/** Vite html tags, prepended to <head> so page styles can override the tokens. */
export function suiteUiTags(){return [
 {tag:'style',attrs:{'data-suite-ui':''},children:suiteUiCss(),injectTo:'head-prepend'},
 {tag:'script',attrs:{'data-suite-ui-boot':''},children:SUITE_UI_BOOT,injectTo:'head-prepend'},
];}
/** @returns {import('vite').Plugin} */
export function suiteUiPlugin(){
 return {name:'suite-ui',transformIndexHtml:{order:'pre',handler(html){if(html.includes('data-suite-ui'))return html;return {html,tags:suiteUiTags()};}},
  // Dev server: a stylesheet edit reloads every open popover.
  configureServer(server){server.watcher.add(SUITE_UI_CSS_PATH);server.watcher.on('change',file=>{if(resolve(file)===SUITE_UI_CSS_PATH)server.ws.send({type:'full-reload'});});}};
}
