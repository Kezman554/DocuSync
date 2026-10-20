// @vitest-environment node
// Highlights are exported, not dropped: a see-through yellow rectangle,
// multiplied over the page, that leaves the text under it as text. Proved
// with a real pdf-lib export, pdf.js extraction and pdf.js rendering.
import { beforeAll, describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts } from 'pdf-lib';
import { buildPdf } from '../src/lib/exportPdf.js';
import { flattenPages } from '../src/lib/flatten.js';
import { createPageModel } from '../src/lib/pageModel.js';
import { HIGHLIGHT, addAnnotation } from '../src/lib/annotations.js';

const FONT_DATA = 'node_modules/pdfjs-dist/standard_fonts/';
let pdfjs;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});
const loadPdf = (bytes) =>
  pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, standardFontDataUrl: FONT_DATA })
    .promise;

const WORDS = 'Highlighted words here';
const TEXT_AT = { x: 72, y: 400, size: 24 };
const BOX = { x: 60, y: 390, width: 400, height: 40 }; // over the words, and blank paper to their right
let textWidth;

async function makeSource() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  textWidth = font.widthOfTextAtSize(WORDS, TEXT_AT.size);
  doc.addPage([612, 792]).drawText(WORDS, { ...TEXT_AT, font });
  doc.addPage([612, 792]).drawText('Second page', { x: 72, y: 700, size: 18, font });
  return doc.save();
}

const src = (bytes) => ({ s1: { name: 'fixture.pdf', bytes } });
const highlight = { id: 'h1', type: 'marker', rect: BOX };

async function exportWithHighlight(extra = {}) {
  const bytes = await makeSource();
  let pages = createPageModel(2);
  pages = addAnnotation(pages, pages[0].id, highlight);
  if (extra.redact) {
    pages = addAnnotation(pages, pages[0].id, { id: 'r1', type: 'redaction', rect: extra.redact });
  }
  const flatten = (pdf, jobs) =>
    flattenPages(pdf, jobs, {
      loadPdf,
      createCanvas,
      encode: async (canvas) => [{ bytes: new Uint8Array(canvas.toBuffer('image/png')), mime: 'image/png' }],
    });
  return { source: bytes, out: await buildPdf(src(bytes), pages, { flatten }) };
}

/** Page 1's content streams, decoded and joined in drawing order. */
async function pageContent(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const refs = contents.asArray ? contents.asArray() : [contents];
  return {
    page,
    doc,
    ops: refs
      .map((ref) => {
        const stream = doc.context.lookup(ref);
        const raw = Buffer.from(stream.contents ?? stream.getContents());
        const filter = stream.dict?.get(PDFName.of('Filter'))?.toString();
        return (stream instanceof PDFRawStream && filter === '/FlateDecode' ? inflateSync(raw) : raw).toString('latin1');
      })
      .join('\n'),
  };
}

/** Render page 1 at 2× and read pixels in PDF coordinates. */
async function renderPage1(bytes) {
  const scale = 2;
  const pdf = await loadPdf(bytes);
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  await pdf.destroy();
  const at = (x, y) => {
    const i = (Math.round((792 - y) * scale) * width + Math.round(x * scale)) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return { at, scale, data, width };
}

/** The darkest pixel inside the words, in PDF coordinates, from a render of `bytes`. */
async function darkestGlyphPoint(bytes) {
  const { at } = await renderPage1(bytes);
  let best = null;
  for (let x = TEXT_AT.x; x < TEXT_AT.x + textWidth; x += 0.5) {
    for (let y = TEXT_AT.y; y < TEXT_AT.y + TEXT_AT.size * 0.7; y += 0.5) {
      const [r, g, b] = at(x, y);
      if (!best || r + g + b < best.sum) best = { x, y, sum: r + g + b };
    }
  }
  return best;
}

const sum = ([r, g, b]) => r + g + b;

/**
 * White paper under the highlight: Multiply at HIGHLIGHT.opacity mixes
 * white with white × yellow, so each channel is 255 × (1 − a + a × c).
 * At 0.45 that's about rgb(255, 236, 140).
 */
const PAPER_UNDER_HIGHLIGHT = [255, 213, 0].map((c) =>
  Math.round(255 * (1 - HIGHLIGHT.opacity + HIGHLIGHT.opacity * (c / 255)))
);
const expectPaperYellow = (pixel) => {
  expect(PAPER_UNDER_HIGHLIGHT).toEqual([255, 236, 140]);
  pixel.forEach((channel, i) => expect(Math.abs(channel - PAPER_UNDER_HIGHLIGHT[i])).toBeLessThanOrEqual(6));
};

describe('highlight export', () => {
  it('bakes a rectangle over the content with opacity under 1 and the Multiply blend', async () => {
    const { out } = await exportWithHighlight();
    const { page, doc, ops } = await pageContent(out);

    // The rectangle (pdf-lib draws it as a filled path, moved into place
    // with cm), after the page's own text: drawn over it.
    const { x, y, width, height } = BOX;
    const drawn = ops.match(
      new RegExp(
        `/(\\S+) gs\\s+([\\d. ]+) rg[\\s\\S]*?1 0 0 1 ${x} ${y} cm[\\s\\S]*?` +
          `0 ${height} l\\s+${width} ${height} l\\s+${width} 0 l\\s+h\\s+f\\b`
      )
    );
    expect(drawn).not.toBeNull();
    expect(ops.indexOf(drawn[0])).toBeGreaterThan(ops.lastIndexOf('Tj'));
    // Filled in the highlight's yellow.
    expect(drawn[2].split(' ').map(Number)).toEqual([1, 213 / 255, 0]);

    // Its graphics state: Multiply, fill opacity under 1.
    const gsName = drawn[1];
    const states = page.node.Resources().lookup(PDFName.of('ExtGState'), PDFDict);
    const gs = doc.context.lookup(states.get(PDFName.of(gsName)), PDFDict);
    expect(gs.get(PDFName.of('BM')).toString()).toBe('/Multiply');
    const ca = gs.get(PDFName.of('ca'));
    expect(ca).toBeInstanceOf(PDFNumber);
    expect(ca.asNumber()).toBeGreaterThan(0);
    expect(ca.asNumber()).toBeLessThan(1);
    expect(ca.asNumber()).toBeCloseTo(HIGHLIGHT.opacity, 5);
  });

  it('leaves the highlighted text extractable by pdf.js', async () => {
    const { out } = await exportWithHighlight();
    const pdf = await loadPdf(out);
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join('');
    await pdf.destroy();
    expect(text).toContain(WORDS);
  });

  it('renders glyphs under it still dark, and blank paper under it yellow', async () => {
    const { source, out } = await exportWithHighlight();
    // A point on a glyph, found in the unhighlighted source.
    const glyph = await darkestGlyphPoint(source);
    expect(glyph.sum).toBeLessThan(120);

    const { at } = await renderPage1(out);
    // On the glyph inside the highlight: still dark (Multiply keeps black black).
    expect(sum(at(glyph.x, glyph.y))).toBeLessThan(120);
    // Blank paper inside the highlight, right of the words: yellow.
    expectPaperYellow(at(TEXT_AT.x + textWidth + 20, BOX.y + BOX.height / 2));
    // Paper outside it: still white.
    expect(at(300, 700)).toEqual([255, 255, 255]);
  });

  it('on a redacted page, flattens with the page: no vector rectangle, still yellow', async () => {
    const { out } = await exportWithHighlight({ redact: { x: 60, y: 600, width: 200, height: 30 } });
    const { ops } = await pageContent(out);
    expect(ops).not.toContain(`1 0 0 1 ${BOX.x} ${BOX.y} cm`);
    expect(ops).toMatch(/Do/); // the page is now just its image
    const { at } = await renderPage1(out);
    expectPaperYellow(at(TEXT_AT.x + textWidth + 20, BOX.y + BOX.height / 2));
  });
});

describe('highlight colour', () => {
  it('matches --marker-fill, the colour the screen draws it in', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    const [, r, g, b, a] = tokens.match(/--marker-fill:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    const hex = `#${[r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
    expect(HIGHLIGHT.color).toBe(hex);
    expect(HIGHLIGHT.opacity).toBe(Number(a));
  });
});
