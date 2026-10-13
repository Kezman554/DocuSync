// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { crc32, createZip } from '../src/lib/zip.js';
import { readZip } from './helpers/zip.js';

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('createZip', () => {
  const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

  it('round-trips files, names and contents', () => {
    const files = [
      { name: 'report-page-01.png', bytes: bytes(1000, 1) },
      { name: 'report-page-02.png', bytes: bytes(5, 2) },
      { name: 'empty.txt', bytes: new Uint8Array() },
    ];
    const read = readZip(createZip(files));
    expect(read.map((f) => f.name)).toEqual(files.map((f) => f.name));
    read.forEach((f, i) => {
      expect(Array.from(f.bytes)).toEqual(Array.from(files[i].bytes));
      expect(f.method).toBe(0); // stored
    });
  });

  it('stores UTF-8 names', () => {
    const [f] = readZip(createZip([{ name: 'Résumé – page 1.jpg', bytes: bytes(10, 3) }]));
    expect(f.name).toBe('Résumé – page 1.jpg');
    expect(f.utf8).toBe(true);
  });

  it('writes a valid empty archive', () => {
    const zip = createZip([]);
    expect(zip).toHaveLength(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('encodes the modification date as DOS date/time', () => {
    const zip = createZip([{ name: 'a', bytes: bytes(1, 0) }], {
      date: new Date(2026, 9, 13, 14, 30, 58),
    });
    const view = new DataView(zip.buffer);
    const time = view.getUint16(10, true);
    const day = view.getUint16(12, true);
    expect([time >> 11, (time >> 5) & 63, (time & 31) * 2]).toEqual([14, 30, 58]);
    expect([(day >> 9) + 1980, (day >> 5) & 15, day & 31]).toEqual([2026, 10, 13]);
  });
});
