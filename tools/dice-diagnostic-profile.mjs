import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {verifyProductionDice} from './dice-production-package.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Select checks only after recognizing a complete built package.
 * Unmarked physical files must never become a light fallback. */
export function identifyBuiltDiceProfile(root,bindings={}){
 root=resolve(root);const physical=join(root,'dice3d'),marker=join(physical,'production-build.json');
 if(existsSync(physical))assert(lstatSync(physical).isDirectory()&&!lstatSync(physical).isSymbolicLink(),'Invalid physical package directory');
 if(existsSync(marker))return {mode:'physical',root,physical:verifyProductionDice(physical,bindings)};
 assert(!existsSync(physical)||readdirSync(physical).length===0,'Unidentified physical files without a production manifest');
 const files={};
 for(const entry of ['index','quick','effect2d','overlay2d']){
  const htmlPath=`workbench-dice/${entry}.html`,scriptPath=`workbench-dice/${entry}.js`;
  for(const file of [htmlPath,scriptPath]){const stat=lstatSync(join(root,file));assert(stat.isFile()&&!stat.isSymbolicLink(),'Invalid light package file: '+file);const bytes=readFileSync(join(root,file));assert(bytes.length,'Empty light package file: '+file);files[file]=digest(bytes);}
  const modules=[...readFileSync(join(root,htmlPath),'utf8').matchAll(/<script\b[^>]*>/g)].filter(match=>/\btype="module"/.test(match[0]));
  assert.equal(modules.length,1,'Unexpected module entries in '+htmlPath);
  const src=modules[0][0].match(/\bsrc="([^"]+)"/);assert(src,'Missing module source in '+htmlPath);
  assert.equal(src[1],`./${entry}.js?v=${files[scriptPath].slice(0,12)}`,'Stale or unexpected light entry dependency: '+htmlPath);
 }
 return {mode:'light',root,files};
}
