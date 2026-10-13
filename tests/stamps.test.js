// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import vm from 'node:vm';

// A Uint8Array constructor from another JS realm, like structured clone can return.
globalThis.__otherRealmUint8Array = vm.runInNewContext('Uint8Array');
import {
  BUILT_IN_STAMPS,
  INITIALS_PRESETS,
  cleanName,
  normalizeStampRecord,
  createImageStamp,
  createInitialsStamp,
  defaultStampSize,
  isValidStamp,
  normalizeInitials,
} from '../src/lib/stamps.js';
import { DB_NAME, STORE, createStampStore } from '../src/lib/stampStore.js';

const fixture = (name) => new Uint8Array(readFileSync(resolve('tests/fixtures', name)));

describe('stamp model', () => {
  it('ships valid built-in tick presets', () => {
    expect(BUILT_IN_STAMPS.map((s) => s.name)).toEqual(['Tick', 'Light tick', 'Cross', 'Dot']);
    for (const stamp of BUILT_IN_STAMPS) {
      expect(stamp.builtIn).toBe(true);
      expect(stamp.kind).toBe('tick');
      expect(stamp.content.font).toBe('ZapfDingbats');
      expect(isValidStamp(stamp)).toBe(true);
    }
  });

  it('normalises initials', () => {
    expect(normalizeInitials(' ny ')).toEqual({ value: 'NY' });
    expect(normalizeInitials('j.r.r.t.')).toEqual({ value: 'J.R.R.T.' });
    expect(normalizeInitials('Zoë')).toEqual({ value: 'ZOË' });
    expect(normalizeInitials('')).toHaveProperty('error');
    expect(normalizeInitials('...')).toHaveProperty('error');
    expect(normalizeInitials('ABCDE').error).toMatch(/Up to 4/);
    expect(normalizeInitials('N7').error).toMatch(/letters only/);
  });

  it('creates initials stamps in each preset look', () => {
    for (const preset of INITIALS_PRESETS) {
      const stamp = createInitialsStamp('ny', preset.id, '#1f4fd1');
      expect(stamp).toMatchObject({
        kind: 'initials',
        name: 'NY',
        content: { type: 'text', text: 'NY', font: preset.font, color: '#1f4fd1' },
      });
      expect(isValidStamp({ ...stamp, id: 'x' })).toBe(true);
    }
    expect(createInitialsStamp('ny', 'nope').content.font).toBe('TimesRomanBoldItalic');
    expect(() => createInitialsStamp('')).toThrow();
  });

  it('creates image stamps only from PNG/JPEG data', () => {
    const stamp = createImageStamp(fixture('logo-200x100.png'), { name: '  My sig  ' });
    expect(stamp).toMatchObject({
      kind: 'signature',
      name: 'My sig',
      content: { type: 'image', mime: 'image/png', width: 200, height: 100 },
    });
    expect(() => createImageStamp(fixture('not-supported.gif'))).toThrow(/PNG and JPG/);
  });

  it('normalises stored image bytes from buffers or other realms', () => {
    const png = fixture('logo-200x100.png');
    const stamp = { id: 'x', kind: 'signature', name: 'x', content: { type: 'image', mime: 'image/png' } };
    // ArrayBuffer, and a Uint8Array made in a different realm (vm context).
    const asBuffer = normalizeStampRecord({ ...stamp, content: { ...stamp.content, bytes: png.buffer.slice(0) } });
    expect(asBuffer.content.bytes).toBeInstanceOf(Uint8Array);
    expect(isValidStamp(asBuffer)).toBe(true);

    const foreign = new (globalThis.__otherRealmUint8Array)(png);
    expect(foreign instanceof Uint8Array).toBe(false);
    const fromForeign = normalizeStampRecord({ ...stamp, content: { ...stamp.content, bytes: foreign } });
    expect(fromForeign.content.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(fromForeign.content.bytes)).toEqual(Array.from(png));
    expect(isValidStamp(fromForeign)).toBe(true);
  });

  it('rejects malformed records', () => {
    expect(isValidStamp(null)).toBe(false);
    expect(isValidStamp({ id: 'a', kind: 'nope', name: 'x', content: { type: 'text' } })).toBe(false);
    expect(
      isValidStamp({ id: 'a', kind: 'tick', name: 'x', content: { type: 'text', text: '', font: 'Helvetica', fontSize: 9, color: '#000' } })
    ).toBe(false);
    expect(
      isValidStamp({ id: 'a', kind: 'signature', name: 'x', content: { type: 'image', bytes: new Uint8Array([1, 2, 3]) } })
    ).toBe(false);
    expect(cleanName('   ', 'Fallback')).toBe('Fallback');
    expect(cleanName('x'.repeat(100))).toHaveLength(60);
  });
});

describe('stamp store (IndexedDB)', () => {
  let factory;
  beforeEach(() => {
    factory = new IDBFactory(); // fresh, empty "browser profile" per test
  });

  it('adds, lists, renames and deletes stamps', async () => {
    const store = createStampStore(factory);
    expect(await store.list()).toEqual([]);

    const a = await store.add(createInitialsStamp('ny'));
    const b = await store.add(createImageStamp(fixture('photo-400x300.jpg'), { name: 'Sig' }));
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect((await store.list()).map((s) => s.name)).toEqual(['NY', 'Sig']);

    const renamed = await store.rename(b.id, 'Signature (work)');
    expect(renamed.name).toBe('Signature (work)');
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(renamed.createdAt);

    await store.remove(a.id);
    expect((await store.list()).map((s) => s.name)).toEqual(['Signature (work)']);
    await expect(store.rename(a.id, 'gone')).rejects.toThrow(/no longer exists/);
  });

  it('persists across closing and reopening (a page reload)', async () => {
    const first = createStampStore(factory);
    const saved = await first.add(createImageStamp(fixture('logo-200x100.png'), { name: 'Logo' }));
    await first.add(createInitialsStamp('ab', 'plain'));
    await first.close();

    const second = createStampStore(factory); // new connection, same database
    const list = await second.list();
    expect(list.map((s) => s.name)).toEqual(['Logo', 'AB']);
    // Image bytes survive intact.
    expect(list[0].id).toBe(saved.id);
    expect(Array.from(list[0].content.bytes)).toEqual(Array.from(fixture('logo-200x100.png')));
    expect(list[1].content.font).toBe('Helvetica');
  });

  it('never stores presets or invalid stamps', async () => {
    const store = createStampStore(factory);
    const copy = await store.add(BUILT_IN_STAMPS[0]); // saving a preset makes a user copy
    expect(copy.builtIn).toBeUndefined();
    expect(copy.id).not.toBe(BUILT_IN_STAMPS[0].id);
    await expect(store.add({ kind: 'tick', name: 'bad', content: { type: 'text' } })).rejects.toThrow();
    expect(await store.list()).toHaveLength(1);
  });

  it('skips corrupt records instead of failing', async () => {
    const store = createStampStore(factory);
    await store.add(createInitialsStamp('ok'));
    await store.close();

    // Write junk straight into the object store.
    await new Promise((res, rej) => {
      const req = factory.open(DB_NAME);
      req.onsuccess = () => {
        const tx = req.result.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id: 'junk', kind: 'tick', name: 1 });
        tx.oncomplete = () => {
          req.result.close();
          res();
        };
        tx.onerror = () => rej(tx.error);
      };
    });
    expect((await createStampStore(factory).list()).map((s) => s.name)).toEqual(['OK']);
  });

  it('rejects clearly when IndexedDB is unavailable', async () => {
    const store = createStampStore(null);
    await expect(store.list()).rejects.toThrow(/not available/);
  });
});

describe('defaultStampSize', () => {
  const letter = { width: 612, height: 792 };
  it('gives signatures a realistic signing width, keeping aspect', () => {
    expect(defaultStampSize({ kind: 'signature', width: 520, height: 180 }, letter)).toEqual({
      width: 160,
      height: (160 * 180) / 520,
    });
  });
  it('uses 1px = 1pt for other images, and caps everything at 40% of the page', () => {
    expect(defaultStampSize({ kind: 'tick', width: 100, height: 50 }, letter)).toEqual({ width: 100, height: 50 });
    const small = defaultStampSize({ kind: 'signature', width: 520, height: 180 }, { width: 300, height: 400 });
    expect(small.width).toBeCloseTo(120, 9); // 40% of a 300pt-wide page
  });
});
