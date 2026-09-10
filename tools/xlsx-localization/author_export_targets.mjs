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
assert.equal(manifest.schema,'obr-main-export-author-inputs/v1');
assert.deepEqual(Object.keys(manifest.plans),['2014','2024']);
const plans={};
for(const version of ['2014','2024']){
  assert.equal(manifest.plans[version].file,`${version}.json`);
  const raw=await fs.readFile(path.join(planDirectory,`${version}.json`));
  assert.equal(sha(raw),manifest.plans[version].sha256);
  plans[version]=JSON.parse(raw);
  assert.equal(plans[version].schema,'obr-xlsx-export-formula-plan/v1');
  assert.equal(plans[version].entries.length,version==='2014'?864:967);
}
await fs.mkdir(authorDirectory);const receipts={};
for(const version of ['2014','2024']){
  const book=Workbook.create(),sheet=book.worksheets.add('English text');
  const rows=[['Record','Rules','Cell','English text'],...plans[version].entries.map(e=>[e.id,e.version,`${e.sheet}!${e.cell}`,e.target])];
  const range=sheet.getRange(`A1:D${rows.length}`);
  // This is a review table: the leading apostrophe stores expressions as text.
  range.values=rows.map(row=>row.map(value=>value.startsWith('=')?`'${value}`:value));
  const actual=range.values;
  for(let r=0;r<rows.length;r++)for(let c=0;c<4;c++)assert.equal(actual[r][c],rows[r][c],`Author table mismatch at row ${r+1}, column ${c+1}`);
  range.format.font={name:'Arial',size:11};sheet.getRange(`D1:D${rows.length}`).format.wrapText=true;
  for(const [col,width] of [['A',25],['B',9],['C',25],['D',95]])sheet.getRange(`${col}:${col}`).format.columnWidth=width;
  sheet.getRange('A1:D1').format.font.bold=true;sheet.freezePanes.freezeRows(1);
  const file=await SpreadsheetFile.exportXlsx(book),output=path.join(authorDirectory,`${version}.xlsx`);await file.save(output);
  receipts[version]={sha256:sha(await fs.readFile(output)),cells:rows.length*4,assignedValuesExact:true};
}
await fs.writeFile(path.join(authorDirectory,'receipt.json'),JSON.stringify({authors:receipts,nativeCardImported:false,formulaTextTableOnly:true},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output:authorDirectory,authors:receipts}));
