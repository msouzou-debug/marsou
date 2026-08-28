/* ---------- minimal ZIP reader ----------
   Word files are ZIP containers, and SheetJS only reads spreadsheets. Rather
   than inline a second library, this walks the central directory itself and
   inflates with the browser's own DecompressionStream — no dependency, nothing
   fetched, works from disk.

   Only what an .docx needs is supported: stored (method 0) and deflate
   (method 8) entries. */

const textDecoder = new TextDecoder('utf-8');

export const canUnzip = () => typeof DecompressionStream === 'function';

function findEndOfCentralDirectory(view, bytes) {
  /* the record is at the very end, after a comment of at most 65535 bytes */
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

/* entry name → {offset, size, method} for every file in the archive */
export function zipIndex(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view, bytes);
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const index = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) return null;
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = textDecoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    index.set(name, { method, compressed, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return index;
}

async function inflate(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* read one entry as UTF-8 text; null when it is absent */
export async function zipReadText(bytes, name, index = zipIndex(bytes)) {
  const entry = index?.get(name);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.localOffset;
  if (view.getUint32(p, true) !== 0x04034b50) return null;
  /* the local header repeats the name and extra field with its own lengths */
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const raw = bytes.subarray(start, start + entry.compressed);
  if (entry.method === 0) return textDecoder.decode(raw);
  if (entry.method !== 8) return null;
  return textDecoder.decode(await inflate(raw));
}
