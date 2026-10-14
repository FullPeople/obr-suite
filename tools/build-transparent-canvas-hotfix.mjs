// Re-emit only the inline shared CSS in already-built overlay documents.
// Their application modules and immutable asset URLs remain byte-identical.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {suiteUiCss} from './suite-ui.mjs';

export const CANVAS_PAGES = ['boss-bar.html','initiative-panel.html','hp-bar.html'];
export function updateCanvasDocument(html) {
  assert(!html.includes('data-native-transparent-canvas'),'Revert the SDK canvas addon first');
  const head = /<html\b[^>]*>/i.exec(html);
  assert(head,'Missing document root');
  if (!head[0].includes('data-suite-canvas="transparent"')) {
    html = html.replace(head[0],head[0].replace(/>$/,' data-suite-canvas="transparent">'));
  }
  const shared = /<style\b[^>]*\bdata-suite-ui(?:="[^"]*")?[^>]*>[\s\S]*?<\/style>/g;
  assert.equal([...html.matchAll(shared)].length,1,'Expected exactly one shared UI stylesheet');
  return html.replace(shared,()=>`<style data-suite-ui="">${suiteUiCss()}</style>`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input,output] = process.argv.slice(2);
  assert(input && output,'Usage: node tools/build-transparent-canvas-hotfix.mjs <built> <output>');
  mkdirSync(output,{recursive:true});
  for (const name of CANVAS_PAGES) writeFileSync(join(output,name),updateCanvasDocument(readFileSync(join(input,name),'utf8')));
  console.log(JSON.stringify({built:true,pages:CANVAS_PAGES,scheme:'normal',sdkThemeDependency:false}));
}
