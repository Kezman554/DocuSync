// @vitest-environment node
// Redaction is proved by extraction, not appearance: real pdf-lib export,
// real pdf.js rendering (via @napi-rs/canvas) and real pdf.js text
// extraction. Covered words must be gone from the file in every form.
import { describe, it, expect, beforeAll } from 'vitest';
import { inflateSync } from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
} from 'pdf-lib';
import { buildPdf, ExportError } from '../src/lib/exportPdf.js';
import { flattenPages } from '../src/lib/flatten.js';
import {
  REDACTION_DPI,
  isRedacted,
  redactedPositions,
  redactionPixelRect,
  redactionRects,
  redactionWarning,
} from '../src/lib/redaction.js';
import { createPageModel } from '../src/lib/pageModel.js';
import { addAnnotation } from '../src/lib/annotations.js';
import { DEFAULT_NUMBERING } from '../src/lib/pageNumbering.js';
import { DEFAULT_WATERMARK } from '../src/lib/watermark.js';
import { fileContains } from './helpers/pdfSearch.js';

const FONT_DATA = 'node_modules/pdfjs-dist/standard_fonts/';
let pdfjs;

const loadPdf = (bytes) =>
  pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    standardFontDataUrl: FONT_DATA,
  }).promise;

const pngOnly = async (canvas) => [
  { bytes: new Uint8Array(canvas.toBuffer('image/png')), mime: 'image/png' },
];
const pngAndJpeg = async (canvas) => [
  ...(await pngOnly(canvas)),
  { bytes: new Uint8Array(canvas.toBuffer('image/jpeg', 85)), mime: 'image/jpeg' },
];

/** buildPdf's `flatten` option, run in Node with the same code as the browser. */
const nodeFlatten = (encode = pngOnly) => (bytes, jobs) =>
  flattenPages(bytes, jobs, { loadPdf, createCanvas, encode });

// Page 1: a heading outside the box and a secret line under it.
// Page 2: no box. Page 3: intrinsic /Rotate 90, secret under a box.
const SECRET = 'SECRET-ACCOUNT 12345678';
const SECRET_BOX = { x: 60, y: 385, width: 260, height: 35 };
const OUTSIDE = 'Public heading';

async function makeSource({ title = 'Merger: SECRET-ACCOUNT' } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Jane Secret');
  doc.setSubject('Account 12345678');
  doc.setKeywords(['SECRET-ACCOUNT']);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const p1 = doc.addPage([612, 792]);
  p1.drawText(OUTSIDE, { x: 72, y: 700, size: 24, font });
  p1.drawText(SECRET, { x: 72, y: 395, size: 14, font });

  const p2 = doc.addPage([612, 792]);
  p2.drawText('Unredacted page two', { x: 72, y: 700, size: 18, font });

  const p3 = doc.addPage([500, 700]);
  p3.drawText(SECRET, { x: 72, y: 395, size: 14, font });
  p3.setRotation(degrees(90));
  return doc.save();
}

const src = (bytes) => ({ s1: { name: 'fixture.pdf', bytes } });

const redactionBox = (rect, id = 'r1') => ({ id, type: 'redaction', rect });
function withBoxes(pages, boxesByIndex) {
  let next = pages;
  for (const [index, rects] of Object.entries(boxesByIndex)) {
    rects.forEach((rect, k) => {
      next = addAnnotation(next, next[index].id, redactionBox(rect, `r${index}-${k}`));
    });
  }
  return next;
}

async function pageTexts(bytes) {
  const pdf = await loadPdf(bytes);
  const texts = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => item.str).join(' ').trim());
  }
  await pdf.destroy();
  return texts;
}

/** pdf.js operators on page `n`, e.g. to prove a page is just one image. */
async function operators(bytes, n) {
  const pdf = await loadPdf(bytes);
  const { fnArray } = await (await pdf.getPage(n)).getOperatorList();
  await pdf.destroy();
  return fnArray;
}

/** Render page `n` as displayed (rotation applied) and return its pixels. */
async function renderPixels(bytes, n, scale = REDACTION_DPI / 72) {
  const pdf = await loadPdf(bytes);
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  await pdf.destroy();
  return {
    width,
    height,
    /** Count of pixels in a px rect darker than mid-grey. */
    dark: (r) => {
      let count = 0;
      for (let y = r.y; y < r.y + r.height; y += 1) {
        for (let x = r.x; x < r.x + r.width; x += 1) {
          const i = (y * width + x) * 4;
          if (data[i] + data[i + 1] + data[i + 2] < 384) count += 1;
        }
      }
      return count;
    },
  };
}

/**
 * The one image on page `index`, decoded from the file as pdf-lib embedded
 * it (embedPng stores 8-bit RGB, Flate-compressed).
 */
async function embeddedImage(bytes, index) {
  const doc = await PDFDocument.load(bytes);
  const xobjects = doc.getPage(index).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  const [image] = xobjects.values().map((ref) => doc.context.lookup(ref));
  const width = image.dict.get(PDFName.of('Width')).asNumber();
  const height = image.dict.get(PDFName.of('Height')).asNumber();
  expect(image.dict.get(PDFName.of('ColorSpace')).toString()).toBe('/DeviceRGB');
  const data = inflateSync(Buffer.from(image.contents));
  return {
    width,
    height,
    nonBlack: (r) => {
      let count = 0;
      for (let y = r.y; y < r.y + r.height; y += 1) {
        for (let x = r.x; x < r.x + r.width; x += 1) {
          const i = (y * width + x) * 3;
          if (data[i] || data[i + 1] || data[i + 2]) count += 1;
        }
      }
      return count;
    },
  };
}

const describePage = async (bytes, n) => {
  const page = (await PDFDocument.load(bytes)).getPage(n - 1);
  return {
    size: [Math.round(page.getWidth()), Math.round(page.getHeight())],
    rotate: page.getRotation().angle,
  };
};

beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

describe('redaction helpers', () => {
  it('finds redacted pages and their boxes', () => {
    const pages = withBoxes(createPageModel(3), { 1: [SECRET_BOX] });
    expect(pages.map(isRedacted)).toEqual([false, true, false]);
    expect(redactedPositions(pages)).toEqual([2]);
    expect(redactionRects(pages[1])).toEqual([SECRET_BOX]);
  });

  it('snaps boxes outward to whole pixels, so no edge pixel is half-covered', () => {
    const pageBox = { x: 0, y: 0, width: 100, height: 100 };
    const canvas = { width: 208, height: 208 };
    // 10.3pt..20.6pt across at 2.08 px/pt → 21.4..42.8 px → 21..43
    const px = redactionPixelRect({ x: 10.3, y: 50, width: 10.3, height: 10 }, pageBox, 2.08, canvas);
    expect(px.x).toBe(21);
    expect(px.x + px.width).toBe(43);
    // y flips: top = (100 - 60) * 2.08 = 83.2 → 83; bottom = 50 * 2.08 = 104
    expect(px.y).toBe(83);
    expect(px.y + px.height).toBe(104);
  });

  it('maps through an offset page box and clips to the canvas', () => {
    const pageBox = { x: 50, y: 100, width: 100, height: 100 };
    const canvas = { width: 100, height: 100 };
    expect(
      redactionPixelRect({ x: 40, y: 150, width: 30, height: 80 }, pageBox, 1, canvas)
    ).toEqual({ x: 0, y: 0, width: 20, height: 50 });
    expect(redactionPixelRect({ x: 0, y: 0, width: 10, height: 10 }, pageBox, 1, canvas)).toBeNull();
  });

  it('warns that redacted pages become images and metadata is dropped', () => {
    expect(redactionWarning(1)).toMatch(/1 redacted page\. It becomes an image/);
    expect(redactionWarning(3)).toMatch(/3 redacted pages\. They become images/);
    expect(redactionWarning(2)).toMatch(/no longer be selectable or searchable/);
    expect(redactionWarning(2)).toMatch(/title, author, subject and keywords/);
    expect(redactionWarning(1)).toMatch(/Form fields that also appear on a redacted page/);
  });
});

describe('redaction export (acceptance: extraction, not appearance)', () => {
  let source;
  beforeAll(async () => {
    source = await makeSource();
  });

  it('control: without a box the secret is extractable and found in the file', async () => {
    const out = await buildPdf(src(source), createPageModel(3));
    const texts = await pageTexts(out);
    expect(texts[0]).toContain(SECRET);
    expect(texts[0]).toContain(OUTSIDE);
    expect(await fileContains(out, 'SECRET-ACCOUNT')).toBe(true);
  });

  it('removes covered text, and leaves text outside the box only as pixels', async () => {
    const pages = withBoxes(createPageModel(3), { 0: [SECRET_BOX] });
    const out = await buildPdf(src(source), pages, { flatten: nodeFlatten() });
    const texts = await pageTexts(out);

    // Redacted page: no text at all — not the covered words, not the heading.
    expect(texts[0]).not.toContain('SECRET');
    expect(texts[0]).not.toContain('12345678');
    expect(texts[0]).not.toContain(OUTSIDE);
    expect(texts[0]).toBe('');
    // Pages without boxes keep real text.
    expect(texts[1]).toBe('Unredacted page two');
    expect(texts[2]).toContain(SECRET);

    // The redacted page is one image and nothing else.
    const ops = await operators(out, 1);
    expect(ops.filter((op) => op === pdfjs.OPS.paintImageXObject)).toHaveLength(1);
    expect(ops).not.toContain(pdfjs.OPS.showText);
  });

  it('keeps the outside text as pixels and paints the box solid black', async () => {
    const pages = withBoxes(createPageModel(3), { 0: [SECRET_BOX] });
    const out = await buildPdf(src(source), pages, { flatten: nodeFlatten() });
    const s = REDACTION_DPI / 72;
    const img = await renderPixels(out, 1, s);
    // Heading region (y 700..724pt from the bottom) has ink.
    const heading = { x: Math.round(72 * s), y: Math.round((792 - 726) * s), width: 150, height: 30 };
    expect(img.dark(heading)).toBeGreaterThan(100);
    // The embedded image itself: every pixel of the snapped box is pure black.
    const flat = await embeddedImage(out, 0);
    expect([flat.width, flat.height]).toEqual([Math.ceil(612 * s), Math.ceil(792 * s)]);
    const inside = redactionPixelRect(SECRET_BOX, { x: 0, y: 0, width: 612, height: 792 }, s, flat);
    expect(flat.nonBlack(inside)).toBe(0);
    // …and the row just above it isn't all black (the box isn't oversized).
    expect(flat.nonBlack({ ...inside, y: inside.y - 1, height: 1 })).toBeGreaterThan(0);
  });

  it('leaves no trace of the covered words anywhere in the file', async () => {
    // Only the redacted page is exported, so any hit must come from it.
    const pages = withBoxes(createPageModel(3), { 0: [SECRET_BOX] }).slice(0, 1);
    const out = await buildPdf(src(source), pages, { flatten: nodeFlatten(pngAndJpeg) });
    expect(await fileContains(out, 'SECRET-ACCOUNT')).toBe(false);
    expect(await fileContains(out, '12345678')).toBe(false);
    expect(await fileContains(out, OUTSIDE)).toBe(false);

    // No fonts survive: the original page's objects weren't copied.
    const doc = await PDFDocument.load(out);
    const fonts = [...doc.context.enumerateIndirectObjects()].filter(
      ([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/Font'
    );
    expect(fonts).toHaveLength(0);
    // No annotations (links, comments, form widgets) on the rebuilt page.
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });

  it('covers DocuSync’s own annotations, page numbers and watermarks too', async () => {
    let pages = withBoxes(createPageModel(3), { 0: [SECRET_BOX] });
    // A text annotation inside the box, and one outside it.
    pages = addAnnotation(pages, pages[0].id, {
      id: 't1',
      type: 'text',
      text: 'NOTE-UNDER-BOX',
      font: 'Helvetica',
      fontSize: 12,
      color: '#000000',
      rotate: 0,
      rect: { x: 200, y: 395, width: 100, height: 14 },
    });
    pages = addAnnotation(pages, pages[0].id, {
      id: 't2',
      type: 'text',
      text: 'NOTE-OUTSIDE',
      font: 'Helvetica',
      fontSize: 12,
      color: '#000000',
      rotate: 0,
      rect: { x: 72, y: 600, width: 100, height: 14 },
    });
    const out = await buildPdf(src(source), pages, {
      flatten: nodeFlatten(),
      pageNumbers: { labels: ['PN-ONE', 'PN-TWO', 'PN-THREE'], style: DEFAULT_NUMBERING },
      watermark: {
        config: { ...DEFAULT_WATERMARK, text: 'WMARK-CONFIDENTIAL' },
        applies: [true, true, false],
      },
    });
    const texts = await pageTexts(out);
    expect(texts[0]).toBe('');
    for (const word of ['NOTE-UNDER-BOX', 'NOTE-OUTSIDE', 'PN-ONE']) {
      expect(await fileContains(out, word)).toBe(false);
    }
    // Page 2's watermark and number are still real text.
    expect(texts[1]).toContain('PN-TWO');
    expect(texts[1]).toContain('WMARK-CONFIDENTIAL');
    // The annotation outside the box still shows, as pixels.
    const s = REDACTION_DPI / 72;
    const img = await renderPixels(out, 1, s);
    expect(
      img.dark({ x: Math.round(72 * s), y: Math.round((792 - 614) * s), width: 120, height: 25 })
    ).toBeGreaterThan(50);
  });

  it('rebuilds the page at its original size and edited rotation', async () => {
    let pages = withBoxes(createPageModel(3), { 2: [SECRET_BOX] });
    pages = pages.map((p, i) => (i === 2 ? { ...p, rotation: 90 } : p));
    const out = await buildPdf(src(source), pages, { flatten: nodeFlatten() });
    // Intrinsic 90 + edit 90 = 180, unrotated size kept.
    expect(await describePage(out, 3)).toEqual({ size: [500, 700], rotate: 180 });
    expect((await pageTexts(out))[2]).toBe('');
    // Upside down, the box lands at the mirrored spot.
    const s = REDACTION_DPI / 72;
    const img = await renderPixels(out, 3, s);
    const box = redactionPixelRect(SECRET_BOX, { x: 0, y: 0, width: 500, height: 700 }, s, img);
    const mirrored = {
      x: img.width - box.x - box.width + 2,
      y: img.height - box.y - box.height + 2,
      width: box.width - 4,
      height: box.height - 4,
    };
    expect(img.dark(mirrored)).toBe(mirrored.width * mirrored.height);
  });

  it('uses the visible (crop) box, so content outside it is dropped too', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText('HIDDEN-MARGIN', { x: 5, y: 20, size: 12, font }); // outside the crop
    page.drawText('VISIBLE TEXT', { x: 100, y: 400, size: 12, font });
    page.setCropBox(50, 100, 500, 600);
    const bytes = await doc.save();

    const box = { x: 90, y: 390, width: 120, height: 25 };
    const pages = withBoxes(createPageModel(1), { 0: [box] });
    const out = await buildPdf(src(bytes), pages, { flatten: nodeFlatten() });
    expect(await describePage(out, 1)).toEqual({ size: [500, 600], rotate: 0 });
    expect(await fileContains(out, 'HIDDEN-MARGIN')).toBe(false);
    expect(await fileContains(out, 'VISIBLE')).toBe(false);
    const s = REDACTION_DPI / 72;
    const img = await renderPixels(out, 1, s);
    const px = redactionPixelRect(box, { x: 50, y: 100, width: 500, height: 600 }, s, img);
    expect(img.dark(px)).toBe(px.width * px.height);
  });

  it('drops the source metadata when any page is redacted', async () => {
    const plain = await PDFDocument.load(await buildPdf(src(source), createPageModel(3)));
    expect(plain.getTitle()).toBe('Merger: SECRET-ACCOUNT');

    const pages = withBoxes(createPageModel(3), { 2: [SECRET_BOX] });
    const out = await buildPdf(src(source), pages, { flatten: nodeFlatten() });
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
    expect(doc.getProducer()).toBe('DocuSync (pdf-lib)');
    expect(await fileContains(out, 'Jane Secret')).toBe(false);
    // The unredacted page 1 still carries "SECRET" as real text, so only
    // check the metadata-only strings above.
  });

  it('keeps the smaller of the candidate encodings', async () => {
    const pages = withBoxes(createPageModel(1), { 0: [SECRET_BOX] });
    let sizes;
    const flatten = (bytes, jobs) =>
      flattenPages(bytes, jobs, {
        loadPdf,
        createCanvas,
        encode: async (canvas) => {
          const all = await pngAndJpeg(canvas);
          sizes = Object.fromEntries(all.map((c) => [c.mime, c.bytes.length]));
          return all;
        },
      });
    const out = await buildPdf(src(source), pages, { flatten });
    const doc = await PDFDocument.load(out);
    const xobjects = doc.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const [image] = xobjects.values().map((ref) => doc.context.lookup(ref));
    const filter = image.dict.get(PDFName.of('Filter'));
    const usedJpeg = (filter instanceof PDFArray ? filter.get(0) : filter).toString() === '/DCTDecode';
    expect(usedJpeg).toBe(sizes['image/jpeg'] < sizes['image/png']);
  });

  it('fails closed: no flattener, a failing one, or a short result exports nothing', async () => {
    const pages = withBoxes(createPageModel(3), { 0: [SECRET_BOX] });
    await expect(buildPdf(src(source), pages)).rejects.toThrow(ExportError);
    await expect(
      buildPdf(src(source), pages, {
        flatten: async () => {
          throw new Error('canvas exploded');
        },
      })
    ).rejects.toThrow(/Couldn’t flatten the redacted pages/);
    await expect(
      buildPdf(src(source), pages, { flatten: async () => [] })
    ).rejects.toThrow(/Couldn’t flatten the redacted pages/);
  });
});

// References from unredacted pages into a redacted one: pdf-lib's copyPages
// follows every reference, so without care these drag the redacted page's
// objects (or a shared form field's value) into the export.
describe('redaction across references between pages', () => {
  const BOX_P1 = { x: 60, y: 580, width: 240, height: 60 };

  /** Two pages; page 1 has body text under and outside the box. */
  async function twoPages() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([612, 792]);
    p1.drawText('PAGEONE-UNDER', { x: 72, y: 620, size: 12, font });
    p1.drawText('PAGEONE-OUTSIDE', { x: 72, y: 300, size: 12, font });
    const p2 = doc.addPage([612, 792]);
    p2.drawText('Page two body', { x: 72, y: 700, size: 12, font });
    return { doc, p1, p2 };
  }

  const redactFirst = () => withBoxes(createPageModel(2), { 0: [BOX_P1] });
  const exportBoth = (bytes, pages) => buildPdf(src(bytes), pages, { flatten: nodeFlatten() });

  async function fieldValues(bytes) {
    const pdf = await loadPdf(bytes);
    const values = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const annots = await (await pdf.getPage(n)).getAnnotations();
      values.push(Object.fromEntries(annots.filter((a) => a.fieldName).map((a) => [a.fieldName, a.fieldValue])));
    }
    await pdf.destroy();
    return values;
  }

  it('drops a form field whose widget is on a redacted page from every page', async () => {
    const { doc, p1, p2 } = await twoPages();
    const form = doc.getForm();
    const shared = form.createTextField('account');
    shared.setText('FIELDVALUE-4242');
    shared.addToPage(p1, { x: 72, y: 600, width: 200, height: 24 });
    shared.addToPage(p2, { x: 72, y: 600, width: 200, height: 24 });
    // A field only on the unredacted page is left alone.
    const other = form.createTextField('other');
    other.setText('KEEP-ME-77');
    other.addToPage(p2, { x: 72, y: 400, width: 200, height: 24 });
    const bytes = await doc.save();

    // Control: unredacted, the value is in the file on both pages.
    const plain = await buildPdf(src(bytes), createPageModel(2));
    expect(await fileContains(plain, 'FIELDVALUE-4242')).toBe(true);
    expect((await fieldValues(plain))[1]).toMatchObject({ account: 'FIELDVALUE-4242' });

    const out = await exportBoth(bytes, redactFirst());
    expect(await fileContains(out, 'FIELDVALUE-4242')).toBe(false);
    expect((await pageTexts(out)).join(' ')).not.toContain('FIELDVALUE');
    const values = await fieldValues(out);
    expect(values[0]).toEqual({});
    expect(values[1]).toEqual({ other: 'KEEP-ME-77' });
    // Nothing of page 1 came along with the field.
    expect(await fileContains(out, 'PAGEONE')).toBe(false);
  });

  it('a link to the redacted page doesn’t bring its content along', async () => {
    const { doc, p1, p2 } = await twoPages();
    const link = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [72, 680, 200, 720],
        Border: [0, 0, 0],
        Dest: [p1.ref, PDFName.of('Fit')],
      })
    );
    p2.node.set(PDFName.of('Annots'), doc.context.obj([link]));
    const bytes = await doc.save();
    expect(await fileContains(await buildPdf(src(bytes), createPageModel(2)), 'PAGEONE-UNDER')).toBe(true);

    const out = await exportBoth(bytes, redactFirst());
    expect(await fileContains(out, 'PAGEONE-UNDER')).toBe(false);
    expect(await fileContains(out, 'PAGEONE-OUTSIDE')).toBe(false);
    expect((await pageTexts(out))[1]).toBe('Page two body');
  });

  it('a comment reply doesn’t bring the redacted page’s comment along', async () => {
    const { doc, p1, p2 } = await twoPages();
    const comment = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [300, 600, 320, 620],
        Contents: PDFString.of('COMMENT-SECRET'),
        P: p1.ref,
      })
    );
    p1.node.set(PDFName.of('Annots'), doc.context.obj([comment]));
    const reply = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [300, 600, 320, 620],
        Contents: PDFString.of('A-REPLY'),
        IRT: comment,
        P: p2.ref,
      })
    );
    p2.node.set(PDFName.of('Annots'), doc.context.obj([reply]));
    const bytes = await doc.save();

    const out = await exportBoth(bytes, redactFirst());
    expect(await fileContains(out, 'COMMENT-SECRET')).toBe(false);
    expect(await fileContains(out, 'PAGEONE')).toBe(false);
    expect(await fileContains(out, 'A-REPLY')).toBe(true); // page 2's own comment stays
  });
});
