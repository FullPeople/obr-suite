// Targeted source/build checks. These are not browser or real-room acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {suiteUiCss,SUITE_UI_BOOT,suiteUiPlugin} from './suite-ui.mjs';
import {CANVAS_PAGES,updateCanvasDocument} from './build-transparent-canvas-hotfix.mjs';

const require = createRequire(resolve(process.env.CANVAS_DEPS_ROOT || '.', 'package.json'));
const postcss = require('postcss');
const css = suiteUiCss(),tree = postcss.parse(css);
const rootSelector = ':root[data-suite-canvas="transparent"]';
const rootRule = tree.nodes.find(node=>node.type==='rule' && node.selector===rootSelector);
assert(rootRule,'Missing transparent canvas policy');
const scheme = rootRule.nodes.find(node=>node.prop==='color-scheme');
assert.equal(scheme.value,'normal');
assert(scheme.important,'A preset/page stylesheet can override the canvas policy');
assert(rootRule.nodes.some(node=>node.prop==='background' && node.value==='transparent' && node.important));
const bodyRule = tree.nodes.find(node=>node.type==='rule' && node.selector.includes('body:not(.config)'));
assert(bodyRule?.nodes.some(node=>node.prop==='background' && node.value==='transparent' && node.important));
assert(!css.includes('theme.mode'),'SDK palette mode must not select the canvas scheme');

let cases=0;
for (const role of ['GM','PLAYER']) for (const preferred of ['light','dark']) for (const theme of ['night','graphite','parchment','celadon']) {
  const attributes = new Map();
  const document = {documentElement:{setAttribute:(key,value)=>attributes.set(key,value),style:new Proxy({}, {set(){throw Error('Theme boot wrote a canvas style');}})}};
  runInNewContext(SUITE_UI_BOOT,{document,localStorage:{getItem:()=>theme},window:{addEventListener(){}},role,preferred});
  assert.equal(attributes.get('data-suite-theme'),theme);
  // Preset declarations remain normal-priority, so none can beat this policy.
  const preset = tree.nodes.find(node=>node.type==='rule' && node.selector.includes(`data-suite-theme="${theme}"`));
  assert(preset && preset.nodes.filter(node=>node.prop==='color-scheme').every(node=>!node.important));
  cases++;
}

for (const name of CANVAS_PAGES) {
  const source=readFileSync(name,'utf8');
  assert(source.includes('data-suite-canvas="transparent"'),name);
  const transformed=suiteUiPlugin().transformIndexHtml.handler(source,{filename:resolve(name)});
  assert(transformed.tags.some(tag=>tag.tag==='style' && tag.children.includes('color-scheme: normal !important')));
  const fixture=source.replace('</head>',`<style data-suite-ui="">old css</style></head>`);
  const emitted=updateCanvasDocument(fixture);
  assert.equal(updateCanvasDocument(emitted),emitted,'Hotfix must be idempotent');
  assert.equal(emitted.replace(/<style data-suite-ui="">[\s\S]*?<\/style>/,''),fixture.replace(/<style data-suite-ui="">[\s\S]*?<\/style>/,''),'Application scripts or markup changed');
  if(process.argv[2]) {
    const built=readFileSync(join(process.argv[2],name),'utf8');
    assert(built.includes(css),'Published inline CSS does not match the exact source');
    assert(!built.includes('data-native-transparent-canvas'),'SDK canvas addon was reintroduced');
    assert(built.indexOf('color-scheme: normal !important') < built.indexOf('<script type="module"'),'Policy must apply before application bootstrap');
  }
}
assert(readFileSync('src/modules/bossBar/style.css','utf8').includes('body.config { color-scheme: dark; padding: 12px 14px; background: #211d23 !important;'),'Boss settings lost their own background');
console.log(JSON.stringify({passed:true,rolePreferencePresetCases:cases,pages:CANVAS_PAGES,checks:'source and emitted HTML',realOwlbearRoomVerified:false,browserRenderingVerified:false}));
