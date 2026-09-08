import { readBooleanFlag } from "./data-normalize.js";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function findEocd(view: DataView): number {
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === EOCD_SIG && i + 22 + view.getUint16(i + 20, true) === view.byteLength) return i;
  }
  throw new Error("ZIP EOCD not found");
}

const MAX_XML_BYTES = 32 * 1024 * 1024;

async function inflateRaw(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const raw = new Uint8Array(bytes.byteLength);
  raw.set(bytes);
  const stream = new Blob([raw]).stream().pipeThrough(ds);
  const reader = stream.getReader(), parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > size || length > MAX_XML_BYTES) throw new Error("XLSX XML size limit exceeded");
      parts.push(value);
    }
  } finally { await reader.cancel(); }
  if (length !== size) throw new Error("XLSX XML length mismatch");
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

// Index the archive first. Only requested XML is inflated, never character portraits/media.
async function readZipEntries(source: Blob | ArrayBuffer | Uint8Array) {
  const buf = source instanceof Blob
    ? await source.arrayBuffer()
    : source instanceof Uint8Array
      ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
      : source;

  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const end = offset + view.getUint32(eocd + 12, true);
  if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true)
      || count !== view.getUint16(eocd + 8, true) || count === 0xffff || end !== eocd) throw new Error("Unsupported XLSX ZIP directory");
  const entries = new Map<string, { compression: number; size: number; compressed: Uint8Array }>();
  function within(start: number, length: number, limit = bytes.length) {
    if (start < 0 || length < 0 || start + length > limit) throw new Error("Truncated XLSX ZIP entry");
  }

  for (let i = 0; i < count; i++) {
    within(offset, 46, end);
    if (view.getUint32(offset, true) !== CEN_SIG) throw new Error("ZIP central directory entry missing");
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    within(offset + 46, nameLen + extraLen + commentLen, end);
    const name = decodeUtf8(bytes.slice(offset + 46, offset + 46 + nameLen));
    if (entries.has(name) || view.getUint16(offset + 8, true) & 1) throw new Error("Ambiguous or encrypted XLSX ZIP entry");
    within(localOffset, 30, view.getUint32(eocd + 16, true));
    if (view.getUint32(localOffset, true) !== LOC_SIG) throw new Error(`ZIP local header missing for ${name}`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    within(localOffset + 30, localNameLen + localExtraLen + compressedSize, view.getUint32(eocd + 16, true));
    if (decodeUtf8(bytes.slice(localOffset + 30, localOffset + 30 + localNameLen)) !== name
        || view.getUint16(localOffset + 8, true) !== compression) throw new Error("XLSX ZIP headers disagree");
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, { compression, size, compressed });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  if (offset !== end) throw new Error("XLSX ZIP directory length mismatch");
  return async (name: string): Promise<Uint8Array | null> => {
    const entry = entries.get(name);
    if (!entry) return null;
    if (entry.size > MAX_XML_BYTES) throw new Error("XLSX XML size limit exceeded");
    if (entry.compression === 8) return inflateRaw(entry.compressed, entry.size);
    if (entry.compression !== 0) throw new Error(`Unsupported ZIP compression method: ${entry.compression}`);
    if (entry.compressed.length !== entry.size) throw new Error("XLSX XML length mismatch");
    return entry.compressed;
  };
}

const SHEET_NS = ["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"];
const OFFICE_REL_NS = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"];
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

function parseXml(bytes: Uint8Array | null, rootName: string, namespaces: string[]): Element | null {
  if (!bytes) return null;
  const xml = decodeUtf8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  const doc = new DOMParser().parseFromString(xml, "application/xml"), root = doc.documentElement;
  return root.localName === rootName && namespaces.includes(root.namespaceURI || "")
    && !doc.getElementsByTagNameNS("*", "parsererror").length ? root : null;
}

function children(node: Element, name: string): Element[] {
  return Array.from(node.children).filter(child => child.localName === name && child.namespaceURI === node.namespaceURI);
}

function hasDirectText(node: Element): boolean {
  return Array.from(node.childNodes).some(child =>
    (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) && !!child.textContent?.trim());
}

function stringText(node: Element): string | null {
  // Phonetic guides (rPh) are not the displayed cell value.
  const simple = children(node, "t"), runs = children(node, "r");
  if (simple.length > 1 || (simple.length && runs.length)
      || hasDirectText(node)
      || Array.from(node.children).some(child => child.namespaceURI !== node.namespaceURI
        || !["t", "r", "rPh", "phoneticPr"].includes(child.localName))) return null;
  const parts = [...simple];
  for (const run of runs) {
    const text = children(run, "t");
    if (text.length !== 1 || children(run, "rPr").length > 1 || hasDirectText(run)
        || Array.from(run.children).some(child => child.namespaceURI !== node.namespaceURI
          || !["t", "rPr"].includes(child.localName))) return null;
    parts.push(text[0]);
  }
  return parts.some(part => part.children.length) ? null : parts.map(part => part.textContent || "").join("");
}

function relationshipPath(relation: Element): string | null {
  if (relation.getAttribute("TargetMode") && relation.getAttribute("TargetMode") !== "Internal") return null;
  const target = relation.getAttribute("Target");
  if (!target || /[:\\?#]/.test(target) || /%(?:2f|5c)/i.test(target)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { return null; }
  if (/[:\\?#\x00-\x1f]/.test(decoded) || decoded.startsWith("//")) return null;
  const parts = decoded.startsWith("/") ? [] : ["xl"];
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

function templateRuleset(value: string | null, formula: string | null): string | null {
  let cached: string | undefined;
  try {
    const data = JSON.parse(value || "null");
    if (data?.schema != null && data.schema !== "obr-suite-card/v1") return null;
    if (data?.schema === "obr-suite-card/v1") cached = data?.meta?.ruleset;
  } catch { /* Author text may invalidate the old unescaped JSON cache. */ }
  const literal = formula?.includes('""schema"":""obr-suite-card/v1""')
    ? /""ruleset"":""(5E2014|5E2024)""/.exec(formula)?.[1] : undefined;
  if (cached && literal && cached !== literal) return null;
  const ruleset = cached || literal;
  return ruleset === "5E2014" || ruleset === "5E2024" ? ruleset : null;
}

export async function readShieldEquippedFromXlsx(source: Blob | ArrayBuffer | Uint8Array): Promise<boolean | null> {
  const read = await readZipEntries(source);
  const workbook = parseXml(await read("xl/workbook.xml"), "workbook", SHEET_NS);
  const relations = parseXml(await read("xl/_rels/workbook.xml.rels"), "Relationships", [PACKAGE_REL_NS]);
  if (!workbook || !relations) return null;
  const groups = children(workbook, "sheets");
  if (groups.length !== 1) return null;
  const sheets = children(groups[0], "sheet");
  const main = sheets.filter(sheet => ["主要", "Main"].includes(sheet.getAttribute("name") || ""));
  if (main.length !== 1) return null;
  const sheetId = (sheet: Element) => {
    const ids = OFFICE_REL_NS.map(ns => sheet.getAttributeNS(ns, "id")).filter(Boolean);
    return ids.length === 1 ? ids[0] : null;
  };
  const id = sheetId(main[0]);
  if (!id || sheets.filter(sheet => sheetId(sheet) === id).length !== 1) return null;
  const rels = children(relations, "Relationship"), ids = rels.map(rel => rel.getAttribute("Id"));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
  const relationship = rels.find(rel => rel.getAttribute("Id") === id);
  const isType = (rel: Element, type: string) => OFFICE_REL_NS.some(ns => rel.getAttribute("Type") === `${ns}/${type}`);
  if (!relationship || !isType(relationship, "worksheet")) return null;
  const path = relationshipPath(relationship);
  if (!path || rels.filter(rel => isType(rel, "worksheet") && relationshipPath(rel) === path).length !== 1) return null;
  const sheet = parseXml(await read(path), "worksheet", SHEET_NS);
  if (!sheet) return null;
  const stringRels = rels.filter(rel => isType(rel, "sharedStrings"));
  if (stringRels.length > 1) return null;
  const sharedPath = stringRels[0] ? relationshipPath(stringRels[0]) : null;
  const strings = sharedPath ? parseXml(await read(sharedPath), "sst", SHEET_NS) : null;
  if (stringRels.length && !strings) return null;
  const shared = strings ? children(strings, "si").map(stringText) : [];
  const data = children(sheet, "sheetData");
  if (data.length !== 1) return null;
  const cells = new Map<string, Element>();
  for (const row of children(data[0], "row")) for (const cell of children(row, "c")) {
    const ref = cell.getAttribute("r");
    if (!ref || cells.has(ref)) return null;
    cells.set(ref, cell);
  }
  const INVALID_CELL = Symbol("invalid XLSX cell");
  function readCell(ref: string): string | null | typeof INVALID_CELL {
    const cell = cells.get(ref);
    if (!cell) return null;
    const type = cell.getAttribute("t") || "";
    const values = children(cell, "v"), inline = children(cell, "is"), formulas = children(cell, "f");
    if (!["", "n", "b", "s", "str", "inlineStr", "d"].includes(type)
        || [values, inline, formulas, children(cell, "extLst")].some(nodes => nodes.length > 1)
        || hasDirectText(cell)
        || [...values, ...formulas].some(node => node.children.length)
        || Array.from(cell.children).some(child => child.namespaceURI !== cell.namespaceURI
          || !["v", "is", "f", "extLst"].includes(child.localName))) return INVALID_CELL;
    if (type === "inlineStr") {
      if (values.length || formulas.length) return INVALID_CELL;
      return inline.length ? stringText(inline[0]) ?? INVALID_CELL : null;
    }
    if (inline.length) return INVALID_CELL;
    if (!values.length) return null;
    const text = values[0].textContent || "";
    if (text === "") return "";
    if (type === "b" && !/^(?:0|1|true|false)$/.test(text.trim())) return INVALID_CELL;
    if ((type === "" || type === "n") && text.trim() && !Number.isFinite(Number(text))) return INVALID_CELL;
    if (type !== "s") return text;
    return /^\d+$/.test(text) ? shared[Number(text)] ?? INVALID_CELL : INVALID_CELL;
  }
  // Both reviewed 2014/2024 layouts share these coordinates. Labels plus the
  // invariant export marker distinguish our adapter from a generic Main sheet.
  // Errors/unresolvable cells must not collapse into the legacy empty-AC gate.
  const values = new Map<string, string | null>();
  for (const ref of ["AV1", "AL39", "AQ39", "AS39", "AQ40", "AS40"]) {
    const result = readCell(ref);
    if (result === INVALID_CELL) return null;
    values.set(ref, result);
  }
  const value = (ref: string) => values.get(ref) ?? null;
  const exportCell = cells.get("AV1");
  const formula = exportCell ? children(exportCell, "f")[0]?.textContent || null : null;
  if (!templateRuleset(value("AV1"), formula)
      || !["盾牌", "Shield"].includes(value("AL39") || "")
      || !["AC", "Armor Class"].includes(value("AQ39") || "")
      || !["着装", "Equipped"].includes(value("AS39") || "")) return null;
  const shieldAc = value("AQ40"), worn = value("AS40");
  // Preserve the existing adapter's AC gate and Yes/No boolean normalization;
  // reconciliation below still writes only shield.equipped, never AC totals.
  if (shieldAc == null || shieldAc === "" || shieldAc === "0") return false;
  return readBooleanFlag(worn);
}

export async function reconcileUploadedCardShieldState(params: {
  apiBase: string;
  roomId: string;
  cardId: string;
  xlsx: Blob | ArrayBuffer | Uint8Array;
}): Promise<boolean> {
  const equipped = await readShieldEquippedFromXlsx(params.xlsx);
  if (equipped == null) return false;

  const dataUrl = `https://obr.dnd.center/characters/${encodeURIComponent(params.roomId)}/${encodeURIComponent(params.cardId)}/data.json`;
  const res = await fetch(dataUrl, { cache: "no-cache" });
  if (!res.ok) throw new Error(`fetch data.json failed: HTTP ${res.status}`);
  const data = await res.json();
  const cur = readBooleanFlag(data?.combat?.shield?.equipped);
  if (cur === equipped) return false;

  const next = {
    ...data,
    combat: {
      ...(data?.combat || {}),
      shield: {
        ...(data?.combat?.shield || {}),
        equipped,
      },
    },
  };
  const putUrl = `${params.apiBase}/${encodeURIComponent(params.roomId)}/${encodeURIComponent(params.cardId)}/data`;
  const put = await fetch(putUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
  if (!put.ok) {
    const body = await put.text();
    throw new Error(`save corrected shield state failed: HTTP ${put.status} ${body.slice(0, 120)}`);
  }
  return true;
}
