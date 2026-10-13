// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import {
  buildImagesPdf,
  defaultPageSize,
  exifOrientation,
  layoutImagePage,
  orientationMatrix,
  orientedSize,
} from '../src/lib/imagesToPdf.js';
import { sniffImage } from '../src/lib/imageInfo.js';

const fixture = (...p) => new Uint8Array(readFileSync(resolve('tests/fixtures', ...p)));
const image = (...p) => {
  const bytes = fixture(...p);
  const info = sniffImage(bytes);
  return { bytes, ...info, orientation: info.mime === 'image/jpeg' ? exifOrientation(bytes) : 1 };
};

describe('exifOrientation', () => {
  it('reads all eight orientations', () => {
    for (let o = 1; o <= 8; o += 1) expect(exifOrientation(fixture('exif', `orient-${o}.jpg`))).toBe(o);
  });
  it('defaults to upright without EXIF, for PNGs, and for damaged data', () => {
    expect(exifOrientation(fixture('photo-400x300.jpg'))).toBe(1);
    expect(exifOrientation(fixture('logo-200x100.png'))).toBe(1);
    expect(exifOrientation(fixture('exif', 'orient-6.jpg').slice(0, 30))).toBe(1);
    expect(exifOrientation(new Uint8Array([0xff, 0xd8]))).toBe(1);
  });
});

describe('orientation geometry', () => {
  it('swaps displayed sides for the 90° orientations', () => {
    expect(orientedSize(90, 120, 1)).toEqual({ width: 90, height: 120 });
    expect(orientedSize(90, 120, 6)).toEqual({ width: 120, height: 90 });
    expect(orientedSize(90, 120, 8)).toEqual({ width: 120, height: 90 });
  });

  it('maps the image exactly onto the target rect, mirroring where EXIF says', () => {
    const [x, y, w, h] = [10, 20, 300, 200];
    for (let o = 1; o <= 8; o += 1) {
      const [a, b, c, d, e, f] = orientationMatrix(o, x, y, w, h);
      const at = (u, v) => [a * u + c * v + e, b * u + d * v + f];
      const corners = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)].map((p) => p.join(','));
      expect(new Set(corners)).toEqual(
        new Set([`${x},${y}`, `${x + w},${y}`, `${x},${y + h}`, `${x + w},${y + h}`])
      );
      // Mirrored orientations flip handedness (negative determinant).
      const mirrored = [2, 4, 5, 7].includes(o);
      expect(Math.sign(a * d - b * c)).toBe(mirrored ? -1 : 1);
    }
  });
});

describe('layoutImagePage', () => {
  it('turns the paper to match the image and fits it inside the margins', () => {
    // 4000×3000 px photo on A4 with ½" margins → landscape A4.
    const box = layoutImagePage({ width: 4000, height: 3000 }, { pageSize: 'a4', margin: 36 });
    expect(box.pageWidth).toBeCloseTo(841.89, 2);
    expect(box.pageHeight).toBeCloseTo(595.28, 2);
    expect(box.width / box.height).toBeCloseTo(4 / 3, 9);
    expect(box.width).toBeLessThanOrEqual(841.89 - 72 + 1e-9);
    expect(box.height).toBeLessThanOrEqual(595.28 - 72 + 1e-9);
    // Centred.
    expect(box.x).toBeCloseTo((box.pageWidth - box.width) / 2, 9);
    expect(box.y).toBeCloseTo((box.pageHeight - box.height) / 2, 9);
  });

  it('keeps portrait images on portrait pages', () => {
    const box = layoutImagePage({ width: 1170, height: 2532 }, { pageSize: 'letter', margin: 36 });
    expect([box.pageWidth, box.pageHeight]).toEqual([612, 792]);
    expect(box.height).toBeCloseTo(792 - 72, 9); // limited by height
  });

  it('never enlarges small images', () => {
    const box = layoutImagePage({ width: 200, height: 100 }, { pageSize: 'letter', margin: 36 });
    expect([box.width, box.height]).toEqual([150, 75]); // 96 dpi → 0.75 pt/px
    expect([box.x, box.y]).toEqual([(792 - 150) / 2, (612 - 75) / 2]); // landscape letter
  });

  it('fit-to-image makes the page the image, capped at 200 inches', () => {
    expect(layoutImagePage({ width: 800, height: 600 }, { pageSize: 'fit' })).toEqual({
      pageWidth: 600,
      pageHeight: 450,
      x: 0,
      y: 0,
      width: 600,
      height: 450,
    });
    const huge = layoutImagePage({ width: 40000, height: 10000 }, { pageSize: 'fit' });
    expect(huge.pageWidth).toBeCloseTo(14400, 6);
    expect(huge.pageWidth / huge.pageHeight).toBeCloseTo(4, 9);
  });

  it('picks Letter for US-style locales and A4 elsewhere', () => {
    expect(defaultPageSize('en-US')).toBe('letter');
    expect(defaultPageSize('es-MX')).toBe('letter');
    expect(defaultPageSize('en-GB')).toBe('a4');
    expect(defaultPageSize('de-DE')).toBe('a4');
    expect(defaultPageSize('')).toBe('a4');
  });
});

describe('buildImagesPdf', () => {
  let pdfjs;
  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  });

  /** Image matrices per page, recovered by replaying pdf.js's operator list. */
  async function pagesOf(bytes) {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const { OPS } = pdfjs;
    const mul = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [
      A * a + B * c, A * b + B * d, C * a + D * c, C * b + D * d, E * a + F * c + e, E * b + F * d + f,
    ];
    const out = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const { fnArray, argsArray } = await page.getOperatorList();
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack = [];
      const images = [];
      fnArray.forEach((fn, i) => {
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = mul(ctm, argsArray[i]);
        else if (fn === OPS.paintImageXObject) images.push(ctm.map((v) => +v.toFixed(3) || 0));
      });
      out.push({ size: page.view.slice(2).map((v) => +v.toFixed(2)), images });
    }
    await pdf.destroy();
    return out;
  }

  it('makes one page per image, in order, each sized and placed by the layout', async () => {
    const images = [image('photo-400x300.jpg'), image('logo-200x100.png'), image('exif', 'orient-6.jpg')];
    const opts = { pageSize: 'letter', margin: 36 };
    const pages = await pagesOf(await buildImagesPdf(images, opts));
    expect(pages).toHaveLength(3);

    images.forEach((img, i) => {
      const shown = orientedSize(img.width, img.height, img.orientation);
      const box = layoutImagePage(shown, opts);
      expect(pages[i].size).toEqual([+box.pageWidth.toFixed(2), +box.pageHeight.toFixed(2)]);
      expect(pages[i].images).toHaveLength(1);
      const expected = orientationMatrix(img.orientation, box.x, box.y, box.width, box.height);
      pages[i].images[0].forEach((v, k) => expect(v).toBeCloseTo(expected[k], 2));
    });

    // Concretely: the 400×300 photo is 300×225 pt, centred on landscape Letter.
    expect(pages[0].size).toEqual([792, 612]);
    expect(pages[0].images[0]).toEqual([300, 0, 0, 225, 246, 193.5]);
    // The sideways-stored phone photo (orientation 6) draws rotated, on a
    // landscape page matching how it's meant to be seen.
    expect(pages[2].size).toEqual([792, 612]);
    expect(pages[2].images[0]).toEqual([0, -67.5, 90, 0, 351, 339.75]);
  });

  it('embeds JPEGs without recompressing and PNGs with their transparency', async () => {
    const jpeg = fixture('photo-400x300.jpg');
    const bytes = await buildImagesPdf([image('photo-400x300.jpg'), image('logo-200x100.png')]);
    const doc = await PDFDocument.load(bytes);
    const streams = doc.getPages().map((p) => {
      const xobjects = p.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
      return doc.context.lookup(xobjects.values()[0]);
    });
    expect(streams[0].dict.get(PDFName.of('Filter'))).toEqual(PDFName.of('DCTDecode'));
    expect(Array.from(streams[0].contents)).toEqual(Array.from(jpeg)); // byte-identical
    expect(streams[1].dict.has(PDFName.of('SMask'))).toBe(true);
    expect(doc.getTitle()).toBe('Images');
  });

  it('honours fit-to-image and rejects an empty list', async () => {
    const pages = await pagesOf(await buildImagesPdf([image('photo-400x300.jpg')], { pageSize: 'fit' }));
    expect(pages[0].size).toEqual([300, 225]);
    expect(pages[0].images[0]).toEqual([300, 0, 0, 225, 0, 0]);
    await expect(buildImagesPdf([])).rejects.toThrow(/at least one/);
  });
});
