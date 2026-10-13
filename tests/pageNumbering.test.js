// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  DEFAULT_NUMBERING,
  NUMBER_POSITIONS,
  formatPageNumber,
  pageNumberAnnotation,
  pageNumberLabels,
} from '../src/lib/pageNumbering.js';
import { textDrawOps } from '../src/lib/textLayout.js';
import { buildPdf } from '../src/lib/exportPdf.js';
import { createPageModel, movePages, rotatePages } from '../src/lib/pageModel.js';

// Helvetica 10pt: line box 12, glyphs 9.25, ascent 7.18 → baseline 8.555 below the box top.
const BASELINE = (12 - 9.25) / 2 + 7.18;
const LETTER = { x: 0, y: 0, width: 612, height: 792 };

describe('labels', () => {
  it('formats numbers in each style', () => {
    expect(formatPageNumber('n', 3, 9)).toBe('3');
    expect(formatPageNumber('page-n', 3, 9)).toBe('Page 3');
    expect(formatPageNumber('page-n-of-total', 3, 9)).toBe('Page 3 of 9');
    expect(formatPageNumber('n-slash-total', 3, 9)).toBe('3 / 9');
    expect(formatPageNumber('dashes', 3, 9)).toBe('– 3 –');
    expect(formatPageNumber('nope', 3, 9)).toBe('3');
  });

  it('numbers every page from the start number, with the last number as total', () => {
    expect(pageNumberLabels(3, { format: 'page-n-of-total' })).toEqual([
      'Page 1 of 3',
      'Page 2 of 3',
      'Page 3 of 3',
    ]);
    expect(pageNumberLabels(3, { format: 'n-slash-total', start: 5 })).toEqual(['5 / 7', '6 / 7', '7 / 7']);
  });

  it('can leave a cover page unnumbered while still counting it', () => {
    expect(pageNumberLabels(3, { format: 'n', skipFirst: true })).toEqual([null, '2', '3']);
  });
});

describe('placement', () => {
  const at = (position, rotation = 0, width = 20) =>
    textDrawOps(pageNumberAnnotation('x', { pageBox: LETTER, rotation }, { position }, width))[0];

  it('puts each position the margin away from the right edges (unrotated)', () => {
    const m = DEFAULT_NUMBERING.margin;
    const top = 792 - m - BASELINE;
    const bottom = m + 12 - BASELINE;
    const expected = {
      'top-left': [m, top],
      'top-center': [(612 - 20) / 2, top],
      'top-right': [612 - m - 20, top],
      'bottom-left': [m, bottom],
      'bottom-center': [(612 - 20) / 2, bottom],
      'bottom-right': [612 - m - 20, bottom],
    };
    for (const position of NUMBER_POSITIONS) {
      const op = at(position);
      expect(op.x).toBeCloseTo(expected[position][0], 9);
      expect(op.y).toBeCloseTo(expected[position][1], 9);
    }
  });

  it('follows the page as displayed when it is rotated', () => {
    // Shown at 90°: 792 wide × 612 tall. Bottom-centre as displayed is PDF
    // x ≈ 612 − 28 − 12 (+ baseline), y = centred along the long side, and
    // the text runs up the page so it reads upright on screen.
    const number = pageNumberAnnotation('x', { pageBox: LETTER, rotation: 90 }, {}, 20);
    expect(number.rotate).toBe(90);
    const [op] = textDrawOps(number);
    expect(op.x).toBeCloseTo(612 - 28 - 12 + BASELINE, 9);
    expect(op.y).toBeCloseTo((792 - 20) / 2, 9);
  });

  it('respects a cropped page box', () => {
    const box = { x: 50, y: 60, width: 400, height: 500 };
    const [op] = textDrawOps(pageNumberAnnotation('x', { pageBox: box, rotation: 0 }, {}, 20));
    expect(op.x).toBeCloseTo(50 + (400 - 20) / 2, 9);
    expect(op.y).toBeCloseTo(60 + 28 + 12 - BASELINE, 9);
  });
});

describe('exported numbering', () => {
  let pdfjs;
  let helvetica;
  let source;

  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await PDFDocument.create();
    helvetica = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([612, 792]);
    doc.addPage([420, 595]); // A5
    doc.addPage([612, 792]).setRotation(degrees(90)); // intrinsically rotated
    doc.addPage([612, 792]);
    source = await doc.save();
  });

  const width = (text, size = 10) => helvetica.widthOfTextAtSize(text, size);

  /** Per page: [{ str, transform }] of the text pdf.js finds, plus page size. */
  async function readPages(bytes) {
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
    }).promise;
    const out = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      out.push({
        view: page.view,
        rotate: page.rotate,
        items: items.filter((i) => i.str.trim()).map((i) => ({ str: i.str, t: i.transform })),
      });
    }
    await pdf.destroy();
    return out;
  }

  const build = (pages, style) =>
    buildPdf({ s1: { name: 'a.pdf', bytes: source } }, pages, {
      pageNumbers: { labels: pageNumberLabels(pages.length, style), style: { ...DEFAULT_NUMBERING, ...style } },
    });

  it('stamps "Page n of N" centred at the bottom of every page', async () => {
    const pages = await readPages(await build(createPageModel(4), { format: 'page-n-of-total' }));
    expect(pages).toHaveLength(4);
    pages.forEach((page, i) => {
      const label = `Page ${i + 1} of 4`;
      expect(page.items.map((it) => it.str)).toEqual([label]);
    });

    const bottom = 28 + 12 - BASELINE;
    // Page 1 (Letter) and page 2 (A5): upright, centred on their own widths.
    expect(pages[0].items[0].t[4]).toBeCloseTo((612 - width('Page 1 of 4')) / 2, 2);
    expect(pages[0].items[0].t[5]).toBeCloseTo(bottom, 2);
    expect(pages[1].items[0].t[4]).toBeCloseTo((420 - width('Page 2 of 4')) / 2, 2);
    expect(pages[1].items[0].t[5]).toBeCloseTo(bottom, 2);
    // Page 3 has /Rotate 90: the number reads upright at the visual bottom.
    const [a, b, c, d, e, f] = pages[2].items[0].t;
    expect([a, b, c, d].map((v) => Math.round(v))).toEqual([0, 10, -10, 0]);
    expect(e).toBeCloseTo(612 - 28 - 12 + BASELINE, 2);
    expect(f).toBeCloseTo((792 - width('Page 3 of 4')) / 2, 2);
  });

  it('numbers by position after reordering and user rotation', async () => {
    let model = movePages(createPageModel(4), ['s1-4'], 0); // source 4 first
    model = rotatePages(model, ['s1-1'], 90); // source 1 (now 2nd) rotated
    const pages = await readPages(await build(model, { format: 'n', position: 'top-right' }));
    expect(pages.map((p) => p.items[0].str)).toEqual(['1', '2', '3', '4']);

    const top = 792 - 28 - BASELINE;
    expect(pages[0].items[0].t[4]).toBeCloseTo(612 - 28 - width('1'), 2);
    expect(pages[0].items[0].t[5]).toBeCloseTo(top, 2);
    // Second page is rotated 90° by the user: top-right as displayed.
    const [, b, , , e, f] = pages[1].items[0].t;
    expect(Math.round(b)).toBe(10);
    expect(e).toBeCloseTo(28 + BASELINE, 2);
    expect(f).toBeCloseTo(792 - 28 - width('2'), 2);
  });

  it('applies the start number and skips the cover page', async () => {
    const pages = await readPages(
      await build(createPageModel(4), { format: 'dashes', start: 10, skipFirst: true })
    );
    expect(pages.map((p) => p.items.map((it) => it.str))).toEqual([[], ['– 11 –'], ['– 12 –'], ['– 13 –']]);
  });

  it('leaves pages alone when numbering is off', async () => {
    const bytes = await buildPdf({ s1: { name: 'a.pdf', bytes: source } }, createPageModel(4));
    expect((await readPages(bytes)).every((p) => p.items.length === 0)).toBe(true);
  });
});
