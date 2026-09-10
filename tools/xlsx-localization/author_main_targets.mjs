import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [planDirectory,authorDirectory,runtime]=process.argv.slice(2);
assert.ok(planDirectory && authorDirectory && runtime);
const require=createRequire(import.meta.url);
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(require.resolve('@oai/artifact-tool',{paths:[path.resolve(runtime)]})).href);
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await fs.readFile(path.join(planDirectory,'manifest.json'),'utf8'));
assert.equal(manifest.schema,'obr-main-display-author-inputs/v1');
assert.deepEqual(Object.keys(manifest.plans),['labels','captions']);
const plans={};
for(const key of ['labels','captions']){
  assert.equal(manifest.plans[key].file,`${key}.json`);
  const raw=await fs.readFile(path.join(planDirectory,`${key}.json`));
  assert.equal(sha(raw),manifest.plans[key].sha256);
  plans[key]=JSON.parse(raw);assert.equal(plans[key].schema,'obr-xlsx-partial-text-candidate/v1');
  assert.equal(plans[key].entries.length,key==='labels'?407:454);
}
await fs.mkdir(authorDirectory);const receipts={};
for(const key of ['labels','captions']){
  const book=Workbook.create(),sheet=book.worksheets.add('English text');
  const rows=[['Record','Rules','Cell','English text'],...plans[key].entries.map(e=>[e.id,e.version,`${e.sheet}!${e.cell}`,e.target])];
  const range=sheet.getRange(`A1:D${rows.length}`);range.values=rows;assert.deepEqual(range.values,rows);
  range.format.font={name:'Arial',size:11};sheet.getRange(`D1:D${rows.length}`).format.wrapText=true;
  for(const [col,width] of [['A',40],['B',9],['C',35],['D',95]])sheet.getRange(`${col}:${col}`).format.columnWidth=width;
  sheet.getRange('A1:D1').format.font.bold=true;sheet.freezePanes.freezeRows(1);
  const file=await SpreadsheetFile.exportXlsx(book),output=path.join(authorDirectory,`${key}.xlsx`);await file.save(output);
  receipts[key]={sha256:sha(await fs.readFile(output)),cells:rows.length*4,allAssignedValuesExact:true};
}
await fs.writeFile(path.join(authorDirectory,'receipt.json'),JSON.stringify({authors:receipts,nativeCardImported:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output:authorDirectory,authors:receipts}));
