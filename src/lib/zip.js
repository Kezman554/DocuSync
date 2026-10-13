/**
 * Minimal ZIP writer (no compression — "stored" entries). Enough for
 * bundling already-compressed PNG/JPG files into one download, without a
 * dependency. Pure; returns the archive as a Uint8Array.
 *
 * Format: per file a local header + data, then a central directory and an
 * end-of-central-directory record (PKWARE APPNOTE 4.3). File names are
 * UTF-8 (general purpose flag bit 11). No ZIP64, so the archive and each
 * entry must stay under 4 GiB / 65,535 entries.
 */

let crcTable;
function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 (IEEE) of `bytes`, as an unsigned 32-bit number. */
export function crc32(bytes) {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date → MS-DOS time/date words (2-second resolution, local time). */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const MAX_U32 = 0xffffffff;

/**
 * @param {{ name: string, bytes: Uint8Array }[]} files
 * @param {{ date?: Date }} [options]  modification time for every entry
 * @returns {Uint8Array}
 */
export function createZip(files, { date = new Date() } = {}) {
  if (files.length > 0xffff) throw new Error('Too many files for a ZIP');
  const encoder = new TextEncoder();
  const { time, date: day } = dosDateTime(date);

  const entries = files.map(({ name, bytes }) => {
    const nameBytes = encoder.encode(name);
    if (bytes.length > MAX_U32) throw new Error(`“${name}” is too large for a ZIP`);
    return { nameBytes, bytes, crc: crc32(bytes) };
  });

  const localSize = entries.reduce((n, e) => n + 30 + e.nameBytes.length + e.bytes.length, 0);
  const centralSize = entries.reduce((n, e) => n + 46 + e.nameBytes.length, 0);
  const total = localSize + centralSize + 22;
  if (total > MAX_U32) throw new Error('The ZIP would be too large');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v) => {
    view.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (v) => {
    view.setUint32(p, v, true);
    p += 4;
  };
  const put = (b) => {
    out.set(b, p);
    p += b.length;
  };

  const offsets = [];
  for (const e of entries) {
    offsets.push(p);
    u32(0x04034b50); // local file header
    u16(20); // version needed
    u16(0x0800); // flags: UTF-8 names
    u16(0); // method: stored
    u16(time);
    u16(day);
    u32(e.crc);
    u32(e.bytes.length); // compressed size
    u32(e.bytes.length); // uncompressed size
    u16(e.nameBytes.length);
    u16(0); // extra length
    put(e.nameBytes);
    put(e.bytes);
  }

  const centralStart = p;
  entries.forEach((e, i) => {
    u32(0x02014b50); // central directory header
    u16(20); // version made by
    u16(20); // version needed
    u16(0x0800);
    u16(0);
    u16(time);
    u16(day);
    u32(e.crc);
    u32(e.bytes.length);
    u32(e.bytes.length);
    u16(e.nameBytes.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]);
    put(e.nameBytes);
  });

  const centralEnd = p;
  u32(0x06054b50); // end of central directory
  u16(0); // this disk
  u16(0); // disk with central directory
  u16(entries.length);
  u16(entries.length);
  u32(centralEnd - centralStart); // central directory size
  u32(centralStart); // and offset
  u16(0); // comment length
  return out;
}
