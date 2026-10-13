import { crc32 } from '../../src/lib/zip.js';

/**
 * Read a ZIP the way unzip tools do: find the end-of-central-directory
 * record, walk the central directory, and follow each entry to its local
 * header. Throws on any inconsistency.
 */
export function readZip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  if (view.getUint32(eocd, true) !== 0x06054b50) throw new Error('no EOCD');
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset + cdSize !== eocd) throw new Error('central directory size/offset mismatch');
  const decoder = new TextDecoder();
  const files = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    // Local header must agree.
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('bad local header');
    if (view.getUint32(local + 14, true) !== crc) throw new Error('local CRC mismatch');
    const localNameLen = view.getUint16(local + 26, true);
    const extraLen = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLen + extraLen;
    const bytes = zip.subarray(start, start + size);
    if (crc32(bytes) !== crc) throw new Error(`CRC mismatch for ${name}`);
    files.push({ name, bytes: Uint8Array.from(bytes), method, utf8: Boolean(flags & 0x800) });
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return files;
}
