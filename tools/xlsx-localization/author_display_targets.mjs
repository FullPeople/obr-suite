// Author separate review tables; the Python adapter preserves native card OOXML.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [planDirectory, outputDirectory, artifactRuntime] = process.argv.slice(2);
assert.ok(planDirectory && outputDirectory && artifactRuntime,
  'Pass the generated plan directory, a new author directory, and the bundled Node dependency directory.');
const require = createRequire(import.meta.url);
const artifactModule = require.resolve('@oai/artifact-tool', { paths: [path.resolve(artifactRuntime)] });
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(artifactModule).href);
const keys = ['body2014', 'body2024', 'labels', 'fields', 'mirrors'];
const root = path.resolve(planDirectory), output = path.resolve(outputDirectory);
await assert.rejects(fs.access(output), { code: 'ENOENT' });
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'obr-spell-display-author-inputs/v1');
assert.deepEqual(Object.keys(manifest.plans), keys);
const plans = {};
for (const key of keys) {
  const record = manifest.plans[key];
  assert.equal(record.file, `${key}.json`);
  const raw = await fs.readFile(path.join(root, record.file));
  assert.equal(createHash('sha256').update(raw).digest('hex'), record.sha256);
  plans[key] = JSON.parse(raw);
  assert.equal(plans[key].entries.length, record.entries);
}
await fs.mkdir(output, { recursive: false });
const receipts = {};
for (const key of keys) {
  const plan = plans[key], book = Workbook.create();
  if (key === 'mirrors') {
    assert.equal(plan.schema, 'obr-body-formula-author/v1');
    const versions = [];
    for (const version of ['2014', '2024']) {
      const entries = plan.entries.filter(e => e.version === version);
      assert.equal(entries.length, version === '2014' ? 522 : 809);
      const sheet = book.worksheets.add(version);
      sheet.getRange('A1:D1').values = [['Record', 'Source cell', 'English body', 'Display formula']];
      const rows = entries.map(e => [e.id, e.cell, e.target]);
      const formulas = entries.map(e => [e.formula]);
      sheet.getRange(`A2:C${entries.length + 1}`).values = rows;
      sheet.getRange(`D2:D${entries.length + 1}`).formulas = formulas;
      assert.deepEqual(sheet.getRange(`A2:C${entries.length + 1}`).values, rows);
      assert.deepEqual(sheet.getRange(`D2:D${entries.length + 1}`).formulas, formulas);
      assert.deepEqual(sheet.getRange(`D2:D${entries.length + 1}`).values, entries.map(e => [e.target]));
      versions.push({ version, records: entries.length, completeFormulaValuesExact: true });
    }
    receipts[key] = { versions };
  } else {
    assert.equal(plan.schema, 'obr-xlsx-partial-text-candidate/v1');
    const sheet = book.worksheets.add('English text');
    const rows = [['Record', 'Rules', 'Cell', 'English text'], ...plan.entries.map(e => [e.id, e.version, `${e.sheet}!${e.cell}`, e.target])];
    const range = sheet.getRange(`A1:D${rows.length}`);
    range.values = rows;
    assert.deepEqual(range.values, rows);
    range.format.font = { name: 'Arial', size: 11 };
    sheet.getRange(`D1:D${rows.length}`).format.wrapText = true;
    for (const [column, width] of [['A', 27], ['B', 9], ['C', 23], ['D', 95]]) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
    sheet.getRange('A1:D1').format.font.bold = true;
    sheet.freezePanes.freezeRows(1);
    receipts[key] = { rows: rows.length, allAuthoredTextExact: true };
  }
  const target = path.join(output, `${key}.xlsx`);
  const file = await SpreadsheetFile.exportXlsx(book);
  await file.save(target);
  receipts[key].sha256 = createHash('sha256').update(await fs.readFile(target)).digest('hex');
  console.log(`${key}: authored ${plan.entries.length} reviewed entries`);
}
await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify({ plans: manifest.plans, authors: receipts, nativeRecalculated: false }, null, 2) + '\n', { flag: 'wx' });
