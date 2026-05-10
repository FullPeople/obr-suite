import { readBooleanFlag } from "./data-normalize.js";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function xmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function findEocd(view: DataView): number {
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error("ZIP EOCD not found");
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const raw = new Uint8Array(bytes.byteLength);
  raw.set(bytes);
  const stream = new Blob([raw]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function readZipEntries(source: Blob | ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
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
  const out = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CEN_SIG) throw new Error("ZIP central directory entry missing");
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decodeUtf8(bytes.slice(offset + 46, offset + 46 + nameLen));

    if (view.getUint32(localOffset, true) !== LOC_SIG) throw new Error(`ZIP local header missing for ${name}`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);

    if (compression === 0) {
      out.set(name, compressed);
    } else if (compression === 8) {
      out.set(name, await inflateRaw(compressed));
    } else {
      throw new Error(`Unsupported ZIP compression method: ${compression}`);
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

function extractSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const items = xml.match(/<si\b[\s\S]*?<\/si>/g) || [];
  for (const item of items) {
    const parts = Array.from(item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((m) => xmlUnescape(m[1]));
    out.push(parts.join(""));
  }
  return out;
}

function extractCell(xml: string, ref: string): { type: string; value: string | null } | null {
  const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = xml.match(new RegExp(`<c\\b[^>]*\\br="${esc}"(?:\\s|>)([^>]*)>([\\s\\S]*?)<\\/c>`));
  if (!m) return null;
  const attr = m[1] || "";
  const body = m[2] || "";
  const type = /(?:^|\s)t="([^"]+)"/.exec(attr)?.[1] || "";
  const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (v != null) return { type, value: xmlUnescape(v) };
  const inline = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
  return { type, value: inline != null ? xmlUnescape(inline) : null };
}

function resolveCellText(cell: { type: string; value: string | null } | null, shared: string[]): string | null {
  if (!cell || cell.value == null) return null;
  if (cell.type === "s") {
    const idx = Number(cell.value);
    return Number.isInteger(idx) && idx >= 0 && idx < shared.length ? shared[idx] : null;
  }
  return cell.value;
}

export async function readShieldEquippedFromXlsx(source: Blob | ArrayBuffer | Uint8Array): Promise<boolean | null> {
  const entries = await readZipEntries(source);
  const sharedXml = entries.get("xl/sharedStrings.xml");
  const sheetXml = entries.get("xl/worksheets/sheet2.xml");
  if (!sharedXml || !sheetXml) return null;

  const shared = extractSharedStrings(decodeUtf8(sharedXml));
  const sheet = decodeUtf8(sheetXml);
  const shieldHeader = resolveCellText(extractCell(sheet, "AL39"), shared);
  const shieldAc = resolveCellText(extractCell(sheet, "AQ40"), shared);
  const worn = resolveCellText(extractCell(sheet, "AS40"), shared);

  if (shieldHeader !== "盾牌") return null;
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
