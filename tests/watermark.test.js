// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  DEFAULT_WATERMARK,
  autoFontSize,
  glyphMetrics,
  watermarkApplies,
  imageWatermarkOp,
  shownSize,
  textWatermarkOp,
} from '../src/lib/watermark.js';
import { buildPdf } from '../src/lib/exportPdf.js';
import { createPageModel, rotatePages } from '../src/lib/pageModel.js';
import { sniffImage } from '../src/lib/imageInfo.js';

const LETTER = { x: 0, y: 0, width: 612, height: 792 };
const rad = (d) => (d * Math.PI) / 180;

/** Centre of a drawn text/image box in PDF space, from its start point. */
function centreOf({ x, y, rotate }, width, offsetY) {
  const a = rad(rotate);
  return {
    x: x + (width / 2) * Math.cos(a) - offsetY * Math.sin(a),
    y: y + (width / 2) * Math.sin(a) + offsetY * Math.cos(a),
  };
}

describe('geometry', () => {
  it('swaps shown sides for sideways pages', () => {
    expect(shownSize(LETTER, 0)).toEqual({ width: 612, height: 792 });
    expect(shownSize(LETTER, 270)).toEqual({ width: 792, height: 612 });
  });

  it('auto-sizes text so its rotated bounds fill 80% of the page', () => {
    const unit = 3; // width per point of size
    const { height } = glyphMetrics('HelveticaBold');
    for (const angle of [0, 30, 45, 90]) {
      const size = autoFontSize(unit, 'HelveticaBold', { width: 612, height: 792 }, angle);
      const c = Math.abs(Math.cos(rad(angle)));
      const s = Math.abs(Math.sin(rad(angle)));
      const bw = (unit * c + height * s) * size;
      const bh = (unit * s + height * c) * size;
      expect(bw).toBeLessThanOrEqual(612 * 0.8 + 1e-6);
      expect(bh).toBeLessThanOrEqual(792 * 0.8 + 1e-6);
      expect(Math.max(bw / (612 * 0.8), bh / (792 * 0.8))).toBeCloseTo(1, 6); // fills one way
    }
  });

  it('centres text on the page at any angle and page rotation', () => {
    const { centre } = glyphMetrics('HelveticaBold');
    for (const rotation of [0, 90, 180, 270]) {
      for (const angle of [0, 30, 45, -45, 90]) {
        const op = textWatermarkOp({ ...DEFAULT_WATERMARK, angle }, { pageBox: LETTER, rotation }, 3);
        expect(op.rotate).toBe(angle + rotation);
        const c = centreOf(op, op.width, centre * op.size);
        expect(c.x).toBeCloseTo(306, 6);
        expect(c.y).toBeCloseTo(396, 6);
      }
    }
  });

  it('sizes images by page width (capped by height) and centres them', () => {
    const image = { width: 400, height: 300 };
    const op = imageWatermarkOp({ ...DEFAULT_WATERMARK, type: 'image', image, imageScale: 0.5, angle: 30 }, { pageBox: LETTER, rotation: 0 });
    expect(op.width).toBeCloseTo(306, 9);
    expect(op.height).toBeCloseTo(229.5, 9);
    const c = centreOf(op, op.width, op.height / 2);
    expect([c.x, c.y].map((v) => +v.toFixed(6))).toEqual([306, 396]);
    // A tall image at full width would overflow the page height: capped.
    const tall = imageWatermarkOp({ ...DEFAULT_WATERMARK, type: 'image', image: { width: 100, height: 400 }, imageScale: 1, angle: 0 }, { pageBox: LETTER, rotation: 0 });
    expect(tall.height).toBeCloseTo(792, 9);
    expect(tall.width).toBeCloseTo(198, 9);
  });
});

describe('watermarkApplies', () => {
  it('selects all pages or the given ranges, ignoring numbers past the end', () => {
    expect(watermarkApplies('all', 3)).toEqual([true, true, true]);
    expect(watermarkApplies('2-3', 4)).toEqual([false, true, true, false]);
    expect(watermarkApplies('3, 9', 4)).toEqual([false, false, true, false]);
    expect(watermarkApplies('9', 4)).toEqual([false, false, false, false]);
    expect(watermarkApplies('nonsense', 2)).toEqual([false, false]);
  });

  it('handles open ranges while typing (e.g. "2-") without enumerating forever', () => {
    expect(watermarkApplies('2-', 4)).toEqual([false, true, true, true]);
    expect(watermarkApplies('-2', 4)).toEqual([true, true, false, false]);
    expect(watermarkApplies('3-100000', 5)).toEqual([false, false, true, true, true]);
    // Huge numbers cost nothing: work is bounded by the page count.
    const started = performance.now();
    expect(watermarkApplies('1-999999999999', 3)).toEqual([true, true, true]);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('exported watermark', () => {
  let pdfjs;
  let bold;
  let source;

  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await PDFDocument.create();
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
    doc.addPage([612, 792]);
    doc.addPage([420, 595]);
    doc.addPage([612, 792]).setRotation(degrees(90));
    source = await doc.save();
  });

  const build = (pages, config, applies = pages.map(() => true)) =>
    buildPdf({ s1: { name: 'a.pdf', bytes: source } }, pages, {
      watermark: { config: { ...DEFAULT_WATERMARK, ...config }, applies },
    });

  /** Per page: text items, opacity values set, and image paint matrices. */
  async function readPages(bytes) {
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
    }).promise;
    const { OPS } = pdfjs;
    const mul = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [
      A * a + B * c, A * b + B * d, C * a + D * c, C * b + D * d, E * a + F * c + e, E * b + F * d + f,
    ];
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      const { fnArray, argsArray } = await page.getOperatorList();
      const opacity = { fill: [], stroke: [] };
      const images = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack = [];
      fnArray.forEach((fn, i) => {
        if (fn === OPS.setGState) {
          for (const [key, value] of argsArray[i][0]) {
            if (key === 'ca') opacity.fill.push(value);
            if (key === 'CA') opacity.stroke.push(value);
          }
        } else if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = mul(ctm, argsArray[i]);
        else if (fn === OPS.paintImageXObject) images.push(ctm);
      });
      pages.push({
        view: page.view,
        text: items.filter((i) => i.str.trim()).map((i) => ({ str: i.str, t: i.transform })),
        opacity,
        images,
      });
    }
    await pdf.destroy();
    return pages;
  }

  it('stamps DRAFT on every page, centred, at 45° and 25% opacity', async () => {
    const pages = await readPages(await build(createPageModel(3), {}));
    const { centre } = glyphMetrics('HelveticaBold');
    pages.forEach((page, i) => {
      expect(page.text.map((t) => t.str)).toEqual(['DRAFT']);
      expect(page.opacity.fill).toContain(0.25);

      const [a, b] = page.text[0].t;
      const size = Math.hypot(a, b);
      const angle = (Math.atan2(b, a) * 180) / Math.PI;
      // Page 3 is shown rotated 90°, so in PDF space the text turns 45 + 90.
      expect(angle).toBeCloseTo(i === 2 ? 135 : 45, 3);

      // Its centre is the page centre.
      const [, , , , e, f] = page.text[0].t;
      const width = bold.widthOfTextAtSize('DRAFT', size);
      const c = centreOf({ x: e, y: f, rotate: angle }, width, centre * size);
      const [w, h] = page.view.slice(2);
      expect(c.x).toBeCloseTo(w / 2, 2);
      expect(c.y).toBeCloseTo(h / 2, 2);
    });
  });

  it('uses the chosen text, size, angle and opacity, on the chosen pages only', async () => {
    const pages = await readPages(
      await build(createPageModel(3), { text: 'CONFIDENTIAL', fontSize: 40, angle: -30, opacity: 0.6 }, [false, true, false])
    );
    expect(pages.map((p) => p.text.map((t) => t.str))).toEqual([[], ['CONFIDENTIAL'], []]);
    const [a, b] = pages[1].text[0].t;
    expect(Math.hypot(a, b)).toBeCloseTo(40, 3);
    expect((Math.atan2(b, a) * 180) / Math.PI).toBeCloseTo(-30, 3);
    expect(pages[1].opacity.fill).toContain(0.6);
    expect(pages[0].opacity.fill).toEqual([]);
  });

  it('follows the user’s page rotation too', async () => {
    const pages = await readPages(await build(rotatePages(createPageModel(3), ['s1-1'], 90), {}));
    const [a, b] = pages[0].text[0].t;
    expect((Math.atan2(b, a) * 180) / Math.PI).toBeCloseTo(135, 3);
  });

  it('draws an image watermark centred, sized, rotated and translucent', async () => {
    const bytes = new Uint8Array(readFileSync(resolve('tests/fixtures/logo-200x100.png')));
    const image = { id: 'wm', bytes, ...sniffImage(bytes) };
    const pages = await readPages(
      await build(createPageModel(3), { type: 'image', image, imageScale: 0.5, angle: 30, opacity: 0.4 })
    );
    pages.forEach((page, i) => {
      expect(page.images).toHaveLength(1);
      expect(page.opacity.fill).toContain(0.4);
      const [a, b, c, d, e, f] = page.images[0];
      // Unit square → width × height, rotated; its centre is the page centre.
      const width = Math.hypot(a, b);
      const height = Math.hypot(c, d);
      expect(width / height).toBeCloseTo(2, 6);
      const shownWidth = i === 2 ? 792 : page.view[2];
      expect(width).toBeCloseTo(shownWidth * 0.5, 3);
      const [w, h] = page.view.slice(2);
      expect(e + (a + c) / 2).toBeCloseTo(w / 2, 2);
      expect(f + (b + d) / 2).toBeCloseTo(h / 2, 2);
    });
  });
});
