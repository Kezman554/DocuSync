import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib';
import {
  COMPRESSION_PRESETS,
  MIN_IMAGE_BYTES,
  explainResult,
  compressPdf,
  compressedFileName,
  formatBytes,
  savingPercent,
  stripJpegMetadata,
  toRgba,
  unpredict,
} from '../src/lib/compress.js';
import { rng } from './helpers/syntheticPhoto.js';

const fixture = (name) => new Uint8Array(readFileSync(resolve(__dirname, 'fixtures', name)));
const PHOTO = fixture('photo-400x300.jpg'); // 3740 bytes

let pdfjs;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

/** Noisy 8-bit samples (incompressible, like a photo). */
function noise(width, height, components, seed = 1) {
  const random = rng(seed);
  return Uint8Array.from({ length: width * height * components }, () => Math.floor(random() * 256));
}

/**
 * Register an image XObject (Flate-compressed unless `filter` is given, in
 * which case `data` is stored as-is) and draw it on `page`.
 */
function addImage(doc, page, { data, width, height, filter, ...extra }) {
  const dict = {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    ...extra,
  };
  Object.keys(dict).forEach((key) => dict[key] === undefined && delete dict[key]);
  const stream =
    filter === undefined
      ? doc.context.flateStream(data, dict)
      : doc.context.stream(data, filter ? { ...dict, Filter: filter } : dict);
  const ref = doc.context.register(stream);
  drawRef(page, ref);
  return ref;
}

function drawRef(page, ref) {
  const name = page.node.newXObject('Im', ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(200, 0, 0, 150, 50, 50),
    drawObject(name),
    popGraphicsState()
  );
}

/** Fake encoder: records calls and returns PHOTO as a 400×300 JPEG. */
function fakeEncoder(result = { bytes: PHOTO, width: 400, height: 300 }) {
  return vi.fn(async () => result);
}

const OPTIONS = { quality: 0.7, maxSide: 400 };

async function reload(bytes) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/** Every image XObject stream in a saved PDF. */
function images(doc) {
  return doc.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    .map(([ref, o]) => ({ ref, dict: o.dict, contents: o.contents }));
}

const name = (dict, key) => dict.get(PDFName.of(key))?.toString();
const num = (dict, key) => dict.get(PDFName.of(key))?.asNumber();

describe('compressPdf: image re-encoding', () => {
  it('re-encodes a Flate RGB image as a smaller JPEG with the new size', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const data = noise(800, 600, 3);
    addImage(doc, page, { data, width: 800, height: 600 });
    const encode = fakeEncoder();

    const result = await compressPdf(await doc.save(), OPTIONS, encode);

    expect(encode).toHaveBeenCalledTimes(1);
    const [input, opts] = encode.mock.calls[0];
    expect(opts).toEqual(OPTIONS);
    expect(input.type).toBe('pixels');
    expect([input.width, input.height]).toEqual([800, 600]);
    // RGBA expansion of the original samples.
    expect(Array.from(input.data.subarray(0, 8))).toEqual([data[0], data[1], data[2], 255, data[3], data[4], data[5], 255]);
    expect(input.data.length).toBe(800 * 600 * 4);

    expect(result).toMatchObject({ images: 1, reencoded: 1 });
    expect(result.after).toBeLessThan(result.before / 50);
    const [image] = images(await reload(result.bytes));
    expect(name(image.dict, 'Filter')).toBe('/DCTDecode');
    expect(name(image.dict, 'ColorSpace')).toBe('/DeviceRGB');
    expect([num(image.dict, 'Width'), num(image.dict, 'Height')]).toEqual([400, 300]);
    expect(image.dict.has(PDFName.of('DecodeParms'))).toBe(false);
    expect(Array.from(image.contents)).toEqual(Array.from(PHOTO));
  });

  it('expands grayscale to RGB and keeps a soft mask (untouched)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const mask = doc.context.register(
      doc.context.flateStream(noise(800, 600, 1, 7), {
        Type: 'XObject', Subtype: 'Image', Width: 800, Height: 600,
        ColorSpace: 'DeviceGray', BitsPerComponent: 8,
      })
    );
    const gray = noise(800, 600, 1, 3);
    addImage(doc, page, { data: gray, width: 800, height: 600, ColorSpace: 'DeviceGray', SMask: mask });
    const encode = fakeEncoder();

    const result = await compressPdf(await doc.save(), OPTIONS, encode);

    // Only the base image is offered; the mask stays lossless.
    expect(encode).toHaveBeenCalledTimes(1);
    expect(Array.from(encode.mock.calls[0][0].data.subarray(0, 4))).toEqual([gray[0], gray[0], gray[0], 255]);
    expect(result).toMatchObject({ images: 1, reencoded: 1 });
    const out = await reload(result.bytes);
    const all = images(out);
    expect(all).toHaveLength(2);
    const base = all.find((i) => i.dict.has(PDFName.of('SMask')));
    const smask = out.context.lookup(base.dict.get(PDFName.of('SMask')));
    expect(name(base.dict, 'Filter')).toBe('/DCTDecode');
    expect(name(smask.dict, 'Filter')).toBe('/FlateDecode');
    expect(num(smask.dict, 'Width')).toBe(800);
  });

  it('undoes a PNG predictor before handing over pixels', async () => {
    const width = 300;
    const height = 200;
    const pixels = noise(width, height, 3, 5);
    const doc = await PDFDocument.create();
    addImage(doc, doc.addPage(), {
      data: pngFilter(pixels, width, height, 3),
      width,
      height,
      DecodeParms: { Predictor: 15, Colors: 3, Columns: width, BitsPerComponent: 8 },
    });
    const encode = fakeEncoder();
    await compressPdf(await doc.save(), OPTIONS, encode);
    const { data } = encode.mock.calls[0][0];
    const rgb = Array.from(data).filter((_, i) => i % 4 !== 3);
    expect(rgb).toEqual(Array.from(pixels));
  });

  it('passes JPEG images to the encoder as JPEG bytes', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const jpg = await doc.embedJpg(PHOTO);
    page.drawImage(jpg, { x: 0, y: 0, width: 200, height: 150 });
    const smaller = { bytes: PHOTO.subarray(0, 2500), width: 400, height: 300 };
    const encode = fakeEncoder(smaller);

    const result = await compressPdf(await doc.save(), OPTIONS, encode);

    const [input] = encode.mock.calls[0];
    expect(input).toMatchObject({ type: 'jpeg', width: 400, height: 300 });
    expect(Array.from(input.bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(result.reencoded).toBe(1);
    expect(images(await reload(result.bytes))[0].contents.length).toBe(2500);
  });

  it('keeps the original when the re-encode is no smaller, or the encoder declines', async () => {
    for (const encoded of [{ bytes: new Uint8Array(PHOTO.length + 10), width: 400, height: 300 }, null]) {
      const doc = await PDFDocument.create();
      doc.addPage().drawImage(await doc.embedJpg(PHOTO), { x: 0, y: 0 });
      const result = await compressPdf(await doc.save(), OPTIONS, fakeEncoder(encoded));
      expect(result.reencoded).toBe(0);
      expect(Array.from(images(await reload(result.bytes))[0].contents)).toEqual(Array.from(PHOTO));
    }
  });

  it('re-encodes an image shared by several pages once', async () => {
    const doc = await PDFDocument.create();
    const ref = addImage(doc, doc.addPage(), { data: noise(800, 600, 3), width: 800, height: 600 });
    drawRef(doc.addPage(), ref);
    drawRef(doc.addPage(), ref);
    const encode = fakeEncoder();
    const result = await compressPdf(await doc.save(), OPTIONS, encode);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(images(await reload(result.bytes))).toHaveLength(1);
  });

  it.each([
    ['CMYK', 'cmyk', { ColorSpace: 'DeviceCMYK', data: noise(100, 100, 4) }],
    ['Indexed', 'colour', { ColorSpace: ['Indexed', 'DeviceRGB', 1, '<000000FFFFFF>'], data: noise(100, 100, 1) }],
    ['16-bit', 'colour', { BitsPerComponent: 16, data: noise(100, 100, 6) }],
    ['a custom Decode array', 'mask', { Decode: [1, 0, 1, 0, 1, 0], data: noise(100, 100, 3) }],
    ['a colour-key mask', 'mask', { Mask: [0, 10, 0, 10, 0, 10], data: noise(100, 100, 3) }],
    ['a stencil mask', 'bilevel', { ImageMask: true, ColorSpace: undefined, BitsPerComponent: 1, data: noise(100, 100, 1) }],
    ['a 1-bit scan', 'bilevel', { ColorSpace: 'DeviceGray', BitsPerComponent: 1, data: noise(13, 100, 1) }],
    ['a CCITT fax scan', 'bilevel', { filter: 'CCITTFaxDecode', ColorSpace: 'DeviceGray', BitsPerComponent: 1, data: noise(13, 100, 1) }],
    ['JPEG 2000', 'jpx', { filter: 'JPXDecode', data: noise(100, 100, 3) }],
    ['a tiny image', 'small', { data: new Uint8Array(30 * 3).fill(200), width: 30, height: 1 }],
  ])('leaves %s alone and says why', async (_, reason, image) => {
    const doc = await PDFDocument.create();
    addImage(doc, doc.addPage(), { width: 100, height: 100, ...image });
    const encode = fakeEncoder();
    const result = await compressPdf(await doc.save(), OPTIONS, encode);
    expect(encode).not.toHaveBeenCalled();
    expect(result.reencoded).toBe(0);
    expect(result.skipped).toEqual({ [reason]: 1 });
  });

  it('counts images the encoder couldn’t shrink or decode', async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawImage(await doc.embedJpg(PHOTO), { x: 0, y: 0 });
    addImage(doc, doc.addPage(), { data: noise(300, 300, 3), width: 300, height: 300 });
    const encode = vi
      .fn()
      .mockResolvedValueOnce({ bytes: new Uint8Array(PHOTO.length + 1), width: 400, height: 300 })
      .mockResolvedValueOnce(null);
    const result = await compressPdf(await doc.save(), OPTIONS, encode);
    expect(result.skipped).toEqual({ nogain: 1, unreadable: 1 });
  });

  it('measures how much of the file is images and fonts', async () => {
    const doc = await PDFDocument.create();
    addImage(doc, doc.addPage(), { data: noise(200, 200, 3), width: 200, height: 200 });
    const fontFile = doc.context.register(doc.context.stream(new Uint8Array(20000).fill(1), {}));
    doc.context.register(doc.context.obj({ Type: 'FontDescriptor', FontName: 'X', FontFile2: fontFile }));
    const bytes = await doc.save({ useObjectStreams: false });
    const { composition, before } = await compressPdf(bytes, OPTIONS, fakeEncoder());
    expect(composition.images).toBeGreaterThan(110000);
    expect(composition.fonts).toBe(20000);
    expect(composition.images + composition.fonts + composition.other).toBe(before);
  });

  it('reports progress per candidate image', async () => {
    const doc = await PDFDocument.create();
    addImage(doc, doc.addPage(), { data: noise(300, 300, 3, 1), width: 300, height: 300 });
    addImage(doc, doc.addPage(), { data: noise(300, 300, 3, 2), width: 300, height: 300 });
    const onProgress = vi.fn();
    await compressPdf(await doc.save(), OPTIONS, fakeEncoder(), onProgress);
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it('keeps text selectable and the result readable by pdf.js', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    addImage(doc, page, { data: noise(800, 600, 3), width: 800, height: 600 });
    page.drawText('Selectable text', { x: 20, y: 250, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
    const result = await compressPdf(await doc.save(), OPTIONS, fakeEncoder());

    const pdf = await pdfjs.getDocument({ data: result.bytes, disableFontFace: true, standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' }).promise;
    const first = await pdf.getPage(1);
    const { items } = await first.getTextContent();
    expect(items.map((i) => i.str).join('')).toBe('Selectable text');
    const { fnArray } = await first.getOperatorList();
    expect(fnArray).toContain(pdfjs.OPS.paintImageXObject);
  });
});

describe('compressPdf: metadata and unused objects', () => {
  async function docWithMetadata() {
    const doc = await PDFDocument.create();
    doc.setTitle('Quarterly report');
    doc.setAuthor('Someone');
    const page = doc.addPage();
    const xmp = doc.context.register(doc.context.stream('<x:xmpmeta>' + 'x'.repeat(4000) + '</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' }));
    doc.catalog.set(PDFName.of('Metadata'), xmp);
    const thumb = doc.context.register(doc.context.stream(new Uint8Array(3000).fill(9), { Width: 10, Height: 100, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
    page.node.set(PDFName.of('Thumb'), thumb);
    page.node.set(PDFName.of('PieceInfo'), doc.context.obj({ App: { Private: 'data' } }));
    return doc;
  }

  it('strips the info dictionary, XMP, PieceInfo and thumbnails, and drops their objects', async () => {
    const before = await (await docWithMetadata()).save({ useObjectStreams: true });
    const result = await compressPdf(before, { ...OPTIONS, stripMetadata: true }, fakeEncoder());
    const out = await reload(result.bytes);
    // (Checked first: pdf-lib's getTitle() creates an empty Info dict.)
    expect(out.context.trailerInfo.Info).toBeUndefined();
    expect(out.getTitle()).toBeUndefined();
    expect(out.getAuthor()).toBeUndefined();
    expect(out.catalog.has(PDFName.of('Metadata'))).toBe(false);
    const page = out.getPage(0).node;
    expect(page.has(PDFName.of('Thumb'))).toBe(false);
    expect(page.has(PDFName.of('PieceInfo'))).toBe(false);
    expect(result.removedObjects).toBeGreaterThanOrEqual(3); // info, XMP, thumbnail
    expect(result.after).toBeLessThan(result.before - 3000);
  });

  it('keeps metadata when not asked to strip it', async () => {
    const before = await (await docWithMetadata()).save();
    const result = await compressPdf(before, { ...OPTIONS, stripMetadata: false }, fakeEncoder());
    const out = await reload(result.bytes);
    expect(out.getTitle()).toBe('Quarterly report');
    expect(out.catalog.has(PDFName.of('Metadata'))).toBe(true);
  });

  it('drops objects nothing refers to', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.register(doc.context.stream(noise(100, 100, 3), {})); // orphan
    const before = await doc.save();
    const result = await compressPdf(before, OPTIONS, fakeEncoder());
    expect(result.removedObjects).toBeGreaterThanOrEqual(1);
    expect(result.after).toBeLessThan(result.before - 25000);
    expect((await reload(result.bytes)).getPageCount()).toBe(1);
  });
});

describe('unpredict', () => {
  it('reverses every PNG filter type', () => {
    const width = 17;
    const height = 9;
    for (const components of [1, 3]) {
      const pixels = noise(width, height, components, components);
      const out = unpredict(pngFilter(pixels, width, height, components), {
        predictor: 15, colors: components, columns: width, rows: height,
      });
      expect(Array.from(out)).toEqual(Array.from(pixels));
    }
  });

  it('reverses the TIFF predictor', () => {
    const pixels = noise(5, 3, 3);
    const encoded = Uint8Array.from(pixels, (v, i) => (i % 15 >= 3 ? (v - pixels[i - 3]) & 0xff : v));
    expect(Array.from(unpredict(encoded, { predictor: 2, colors: 3, columns: 5, rows: 3 }))).toEqual(Array.from(pixels));
  });

  it('rejects short data and unknown row filters', () => {
    expect(unpredict(new Uint8Array(5), { predictor: 15, colors: 1, columns: 4, rows: 2 })).toBeNull();
    expect(unpredict(Uint8Array.of(7, 1, 2), { predictor: 15, colors: 1, columns: 2, rows: 1 })).toBeNull();
  });
});

describe('helpers', () => {
  it('toRgba expands gray and RGB', () => {
    expect(Array.from(toRgba(Uint8Array.of(10, 20), 2, 1, 1))).toEqual([10, 10, 10, 255, 20, 20, 20, 255]);
    expect(Array.from(toRgba(Uint8Array.of(1, 2, 3), 1, 1, 3))).toEqual([1, 2, 3, 255]);
  });

  it('stripJpegMetadata removes EXIF (APP1) but keeps the image data', () => {
    const jpeg = fixture('exif/orient-6.jpg');
    const stripped = stripJpegMetadata(jpeg);
    expect(stripped.length).toBeLessThan(jpeg.length);
    const hasApp1 = (b) => { for (let i = 2; i + 1 < b.length; i += 1) { if (b[i] === 0xff && b[i + 1] === 0xda) return false; if (b[i] === 0xff && b[i + 1] === 0xe1) return true; } return false; };
    expect(hasApp1(jpeg)).toBe(true);
    expect(hasApp1(stripped)).toBe(false);
    // Everything from the start of scan on is unchanged.
    const sos = (b) => b.findIndex((v, i) => v === 0xff && b[i + 1] === 0xda);
    expect(Array.from(stripped.subarray(sos(stripped)))).toEqual(Array.from(jpeg.subarray(sos(jpeg))));
    expect(stripJpegMetadata(stripped)).toBe(stripped);
    const junk = Uint8Array.of(1, 2, 3);
    expect(stripJpegMetadata(junk)).toBe(junk);
  });

  it('explains a result in plain language', () => {
    expect(
      explainResult({
        before: 1_000_000, images: 5, reencoded: 2, skipped: { cmyk: 2, small: 1 },
        composition: { images: 600_000, fonts: 100_000, other: 300_000 },
      })
    ).toEqual([
      '2 of 5 images re-encoded.',
      'Left unchanged — 2 images: CMYK print colour, which browsers can’t re-encode faithfully.',
      'Left unchanged — 1 image: too small to be worth it.',
    ]);
    expect(
      explainResult({
        before: 1_500_000, images: 0, reencoded: 0, skipped: {},
        composition: { images: 0, fonts: 1_100_000, other: 400_000 },
      })
    ).toEqual([
      'There are no photos or scanned images to re-encode.',
      'Most of this file (1.0 MB) is embedded fonts, which compression leaves untouched.',
    ]);
    expect(
      explainResult({
        before: 1_000_000, images: 0, reencoded: 0,
        composition: { images: 0, fonts: 100_000, other: 900_000 },
      })
    ).toContain('Most of this file is text and page content, which is already stored compressed.');
  });

  it('formats sizes and savings', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(204800)).toBe('200 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(savingPercent(1000, 250)).toBe(75);
    expect(savingPercent(1000, 1100)).toBe(-10);
    expect(savingPercent(0, 0)).toBe(0);
    expect(compressedFileName('Scan.PDF')).toBe('Scan-compressed.pdf');
  });

  it('presets get smaller as they get stronger', () => {
    const { light, balanced, strong } = COMPRESSION_PRESETS;
    expect(light.quality).toBeGreaterThan(balanced.quality);
    expect(balanced.quality).toBeGreaterThan(strong.quality);
    expect(light.maxSide).toBeGreaterThan(balanced.maxSide);
    expect(balanced.maxSide).toBeGreaterThan(strong.maxSide);
    expect(MIN_IMAGE_BYTES).toBeGreaterThan(0);
  });
});

/** PNG-filter rows, cycling through filter types 0–4. */
function pngFilter(pixels, width, height, bpp) {
  const rowBytes = width * bpp;
  const out = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const type = y % 5;
    out[y * (rowBytes + 1)] = type;
    for (let x = 0; x < rowBytes; x += 1) {
      const cur = pixels[y * rowBytes + x];
      const a = x >= bpp ? pixels[y * rowBytes + x - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * rowBytes + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[(y - 1) * rowBytes + x - bpp] : 0;
      let pred = 0;
      if (type === 1) pred = a;
      else if (type === 2) pred = b;
      else if (type === 3) pred = (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * (rowBytes + 1) + 1 + x] = (cur - pred) & 0xff;
    }
  }
  return out;
}
