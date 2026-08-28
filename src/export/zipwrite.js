/* ---------- minimal ZIP writer ----------
   A .pptx is a ZIP of XML parts. Rather than inline a packaging library, this
   writes the archive itself and compresses with the browser's own
   CompressionStream. Where that is unavailable the entries are stored
   uncompressed — a larger file, but a valid one that PowerPoint still opens. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const encoder = new TextEncoder();
const canDeflate = () => typeof CompressionStream === 'function';

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* entries: [{ name, data: string | Uint8Array }] */
export async function zipWrite(entries) {
  const locals = [], central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(raw);
    let method = 0, body = raw;
    if (canDeflate() && raw.length > 64) {
      const packed = await deflate(raw);
      /* a "compressed" part that grew is stored instead */
      if (packed.length < raw.length) { method = 8; body = packed; }
    }

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);        // names are UTF-8
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, method, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, body.length, true);
    dv.setUint32(24, raw.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);

    locals.push(local, body);
    central.push(dir);
    offset += local.length + body.length;
  }

  const dirSize = central.reduce((a, d) => a + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...locals, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
