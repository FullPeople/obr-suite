// Read-only source probe. No host, scene writes, renderer, or visual success claim.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';
import {build} from 'rolldown';

const sourcePath = new URL('../src/modules/bubbles/index.ts', import.meta.url);
const source = readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile('bubbles.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const constants = new Set(['BAR_HEIGHT', 'BAR_PADDING', 'BAR_FONT_SIZE', 'TEXT_VERTICAL_OFFSET', 'DIAMETER', 'BUBBLE_FONT_SIZE', 'BUBBLE_FONT_SIZE_TIGHT', 'TOKEN_TEXT_FONT_BASE', 'DISABLE_INHERIT']);
const functions = new Set(['getImageCenter', 'getRenderedSize', 'computeLayoutFromMetrics', 'computeLayout', 'layoutAnchorSignature', 'structureHash', 'valueHash']);
const selected = [];
for (const statement of ast.statements) {
  if (ts.isFunctionDeclaration(statement) && functions.has(statement.name?.text)) selected.push(statement.getText(ast));
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && constants.has(declaration.name.text)) selected.push(`const ${declaration.getText(ast)};`);
  }
}
let hashExpression;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'rebuildHash' && node.initializer) {
    assert.equal(hashExpression, undefined, 'Multiple rebuildHash expressions; review probe extraction');
    hashExpression = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(hashExpression, 'Production hash expression was not found');
assert.equal(selected.length, constants.size + functions.size, 'Production probe extraction drifted');
const sdkMathPath = new URL('../node_modules/@owlbear-rodeo/sdk/lib/math/Math2.js', import.meta.url);
const virtualSource = `import {Math2} from ${JSON.stringify(fileURLToPath(sdkMathPath).replaceAll('\\', '/'))};\n${selected.join('\n')}\n
const effectiveData = {hp:30,maxHp:40,tempHp:0,ac:16,hide:false,locked:false};
export function inspect(image, overheadModeFlag=false) {
  const verticalOffset=-20, offsetByTextFlag=false, viewMode='full';
  const has={hp:true,ac:true,temp:false};
  const layout=computeLayout(image,150,effectiveData,1,verticalOffset,offsetByTextFlag,false,overheadModeFlag);
  const it=image;
  const hash=${hashExpression};
  return {layout,hash,disableAttachmentBehavior:DISABLE_INHERIT};
}`;
const outputRoot = resolve(tmpdir()), out = mkdtempSync(join(outputRoot, 'bubbles-scale-audit-'));
try {
  const bundlePath = join(out, 'probe.mjs');
  await build({input: 'probe:entry', plugins:[{
    name:'read-only-bubbles-extraction',
    resolveId(id){if(id==='probe:entry')return id;},
    load(id){if(id==='probe:entry')return {code:virtualSource,moduleType:'ts'};},
  }], output:{file:bundlePath,format:'esm'},logLevel:'silent'});
  const probe = await import(pathToFileURL(bundlePath).href);
  const image = {id:'probe-token',type:'IMAGE',visible:true,position:{x:1000,y:1000},rotation:0,scale:{x:1,y:1},image:{width:150,height:300},grid:{dpi:150,offset:{x:75,y:150}}};
  const result = [];
  function compare(name, before, after, overhead = false) {
    const a=probe.inspect(before,overhead), b=probe.inspect(after,overhead);
    result.push({name,overhead,before:{origin:a.layout.barOrigin,width:a.layout.barWidth,height:a.layout.barHeight},after:{origin:b.layout.barOrigin,width:b.layout.barWidth,height:b.layout.barHeight},hashChanged:a.hash!==b.hash,originChanged:JSON.stringify(a.layout.barOrigin)!==JSON.stringify(b.layout.barOrigin)});
    return result.at(-1);
  }
  const uniform = compare('uniform-scale control',image,{...image,scale:{x:2,y:2}});
  assert.equal(uniform.hashChanged,true);
  for (const overhead of [false,true]) {
    const height=compare('height-only resize with constant minimum dimension',image,{...image,scale:{x:1,y:2}},overhead);
    assert.equal(height.originChanged,true);
    assert.equal(height.hashChanged,true);
  }
  const anchored={...image,grid:{dpi:150,offset:{x:0,y:0}}};
  const flip=compare('off-centre horizontal flip',anchored,{...anchored,scale:{x:-1,y:1}});
  assert.equal(flip.originChanged,true);
  assert.equal(flip.hashChanged,true);
  const rotation=compare('off-centre quarter-turn',anchored,{...anchored,rotation:90});
  assert.equal(rotation.originChanged,true);
  assert.equal(rotation.hashChanged,true);
  const move=compare('position-only control; inherited by host',image,{...image,position:{x:1100,y:1000}});
  assert.equal(move.hashChanged,false);
  console.log(JSON.stringify({
    source:'src/modules/bubbles/index.ts',sourceSha256:createHash('sha256').update(source).digest('hex'),sdkMath:`installed SDK ${JSON.parse(readFileSync(new URL('../node_modules/@owlbear-rodeo/sdk/package.json',import.meta.url),'utf8')).version} Math2`,
    scope:'Actual production layout/hash expressions and installed SDK math only; no Owlbear renderer or drag-time state was observed.',
    committedAnchorSignatureCovered:true,hostUatPassed:false,disableAttachmentBehavior:probe.inspect(image).disableAttachmentBehavior,cases:result,
    interpretation:'Committed relative anchor changes now alter the rebuild signature; ordinary translation does not. Native attachment behavior still requires real-room measurement; this is not proof of the rendered screen location.'
  },null,2));
} finally {
  assert.equal(dirname(out),outputRoot);
  rmSync(out,{recursive:true,force:true});
}
