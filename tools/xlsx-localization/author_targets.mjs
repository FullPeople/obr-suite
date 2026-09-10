// Run a copy in a task-specific directory whose node_modules junction points
// at the bundled runtime, not at the application's npm dependencies.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const [planPath, outputPath] = process.argv.slice(2);
assert.ok(planPath && outputPath, "Pass the located candidate plan and a new target workbook path");
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
assert.equal(plan.schema, "obr-xlsx-partial-text-candidate/v1");
await assert.rejects(fs.access(outputPath), { code: "ENOENT" });
const book = Workbook.create(), sheet = book.worksheets.add("English text");
const rows = [["Record", "Rules", "Cell", "English text"], ...plan.entries.map(row => [row.id, row.version, `${row.sheet}!${row.cell}`, row.target])];
const range = sheet.getRange(`A1:D${rows.length}`);
range.values = rows;
assert.deepEqual(range.values, rows, "Artifact-tool target content differs from the reviewed plan");
range.format.font = { name: "Arial", size: 11 };
sheet.getRange(`D1:D${rows.length}`).format.wrapText = true;
sheet.getRange("A:A").format.columnWidth = 27;
sheet.getRange("B:B").format.columnWidth = 9;
sheet.getRange("C:C").format.columnWidth = 23;
sheet.getRange("D:D").format.columnWidth = 95;
sheet.getRange("A1:D1").format.font.bold = true;
sheet.freezePanes.freezeRows(1);
const inspected = await book.inspect({ kind: "table", range: "'English text'!A1:D4", include: "values", tableMaxRows: 4, tableMaxCols: 4, tableMaxCellChars: 140, maxChars: 2200 });
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath + ".inspect.ndjson", inspected.ndjson);
const file = await SpreadsheetFile.exportXlsx(book);
await file.save(outputPath);
console.log(`Authored ${plan.entries.length} exact English cell values; native workbook structure is handled by the preservation adapter.`);
