// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { defaultImageSize, sniffImage } from '../src/lib/imageInfo.js';
import { resizeRectLocked } from '../src/lib/annotations.js';
import { buildPdf } from '../src/lib/exportPdf.js';
import { createPageModel } from '../src/lib/pageModel.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe('sniffImage', () => {
  it('reads PNG and JPEG (baseline and progressive) sizes from the header', () => {
    expect(sniffImage(fixture('logo-200x100.png'))).toEqual({
      mime: 'image/png',
      width: 200,
      height: 100,
    });
    expect(sniffImage(fixture('photo-400x300.jpg'))).toEqual({
      mime: 'image/jpeg',
      width: 400,
      height: 300,
    });
    expect(sniffImage(fixture('progressive-120x90.jpg'))).toEqual({
      mime: 'image/jpeg',
      width: 120,
      height: 90,
    });
  });

  it('accepts an ArrayBuffer too', () => {
    expect(sniffImage(fixture('logo-200x100.png').buffer)?.width).toBe(200);
  });

  it('rejects other formats and damaged data', () => {
    expect(sniffImage(fixture('not-supported.gif'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(fixture('photo-400x300.jpg').slice(0, 40))).toBeNull(); // truncated
    expect(sniffImage(fixture('logo-200x100.png').slice(0, 20))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe('defaultImageSize', () => {
  const letter = { width: 612, height: 792 };
  it('uses 1px = 1pt when it fits within 40% of the page', () => {
    expect(defaultImageSize({ width: 200, height: 100 }, letter)).toEqual({ width: 200, height: 100 });
  });
  it('shrinks large images, keeping the aspect ratio', () => {
    const size = defaultImageSize({ width: 4000, height: 3000 }, letter);
    expect(size.width).toBeCloseTo(244.8, 9); // 40% of 612
    expect(size.width / size.height).toBeCloseTo(4 / 3, 9);
  });
});

describe('resizeRectLocked', () => {
  const bounds = { width: 600, height: 800 };
  const rect = { x: 100, y: 100, width: 200, height: 100 }; // 2:1

  it('keeps the aspect ratio, following the larger drag', () => {
    expect(resizeRectLocked(rect, 'se', 100, 0, bounds)).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    expect(resizeRectLocked(rect, 'se', 0, 100, bounds)).toEqual({ x: 100, y: 100, width: 400, height: 200 });
  });

  it('keeps the opposite corner fixed for every handle', () => {
    expect(resizeRectLocked(rect, 'nw', -100, 0, bounds)).toEqual({ x: 0, y: 50, width: 300, height: 150 });
    expect(resizeRectLocked(rect, 'ne', 100, 0, bounds)).toEqual({ x: 100, y: 50, width: 300, height: 150 });
    expect(resizeRectLocked(rect, 'sw', -50, 0, bounds)).toEqual({ x: 50, y: 100, width: 250, height: 125 });
  });

  it('shrinks to a minimum size and stops at the page edge', () => {
    const tiny = resizeRectLocked(rect, 'se', -500, -500, bounds, 12);
    expect(tiny).toEqual({ x: 100, y: 100, width: 24, height: 12 });
    // Dragging nw: the fixed corner is (300, 200), leaving 300 × 200 px of
    // room up and left. At 2:1 the width runs out first: 300 × 150.
    const big = resizeRectLocked(rect, 'nw', -900, -900, bounds);
    expect(big).toEqual({ x: 0, y: 50, width: 300, height: 150 });
  });
});

/**
 * Where each image was drawn on a page, recovered from pdf.js's operator
 * list: replay save/restore/transform to get the matrix in effect at each
 * image paint, which maps the image's unit square onto the page.
 */
async function imagePlacements(pdfjs, bytes, pageNumber) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(pageNumber);
  const { fnArray, argsArray } = await page.getOperatorList();
  const { OPS } = pdfjs;
  const paints = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject]);
  const mul = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [
    A * a + B * c,
    A * b + B * d,
    C * a + D * c,
    C * b + D * d,
    E * a + F * c + e,
    E * b + F * d + f,
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const found = [];
  fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, argsArray[i]);
    else if (paints.has(fn)) found.push(ctm.map((v) => +v.toFixed(4) || 0)); // no -0
  });
  await pdf.destroy();
  return found;
}

describe('image export', () => {
  let pdfjs;
  let source;

  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    source = await doc.save();
  });

  const image = (name, id = name) => {
    const bytes = fixture(name);
    return { id, bytes, ...sniffImage(bytes) };
  };
  const withAnnotations = (byPage) =>
    createPageModel(2).map((p, i) => (byPage[i] ? { ...p, annotations: byPage[i] } : p));
  const build = (pages) => buildPdf({ s1: { name: 'a.pdf', bytes: source } }, pages);

  it('draws a JPEG at its rect and size (unrotated)', async () => {
    const pages = withAnnotations({
      0: [{ id: 'i1', type: 'image', rotate: 0, rect: { x: 72, y: 500, width: 200, height: 150 }, image: image('photo-400x300.jpg') }],
    });
    const [m] = await imagePlacements(pdfjs, await build(pages), 1);
    // Unit square → x 72..272, y 500..650.
    expect(m).toEqual([200, 0, 0, 150, 72, 500]);
  });

  it('draws a transparent PNG and keeps its alpha channel', async () => {
    const pages = withAnnotations({
      0: [{ id: 'i1', type: 'image', rotate: 0, rect: { x: 10, y: 20, width: 100, height: 50 }, image: image('logo-200x100.png') }],
    });
    const out = await build(pages);
    expect(await imagePlacements(pdfjs, out, 1)).toEqual([[100, 0, 0, 50, 10, 20]]);
    const doc = await PDFDocument.load(out);
    const xobjects = doc.getPages()[0].node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const [ref] = xobjects.values();
    expect(doc.context.lookup(ref).dict.has(PDFName.of('SMask'))).toBe(true);
  });

  it('rotates an image placed upright on a rotated page (90°)', async () => {
    // Placed on a page shown at 90°: rotate 90, own 200×150 → bounds 150×200.
    const pages = withAnnotations({
      0: [{ id: 'i1', type: 'image', rotate: 90, rect: { x: 300, y: 100, width: 150, height: 200 }, image: image('photo-400x300.jpg') }],
    });
    const [m] = await imagePlacements(pdfjs, await build(pages), 1);
    // Anchor (own bottom-left) at (450, 100); width runs up +y, height runs −x.
    expect(m).toEqual([0, 200, -150, 0, 450, 100]);
  });

  it('handles 180° and 270° orientations', async () => {
    const rect = { x: 100, y: 100, width: 200, height: 150 };
    const p180 = withAnnotations({ 0: [{ id: 'a', type: 'image', rotate: 180, rect, image: image('photo-400x300.jpg') }] });
    expect((await imagePlacements(pdfjs, await build(p180), 1))[0]).toEqual([-200, 0, 0, -150, 300, 250]);
    const r270 = { x: 100, y: 100, width: 150, height: 200 };
    const p270 = withAnnotations({ 0: [{ id: 'a', type: 'image', rotate: 270, rect: r270, image: image('photo-400x300.jpg') }] });
    expect((await imagePlacements(pdfjs, await build(p270), 1))[0]).toEqual([0, -200, 150, 0, 100, 300]);
  });

  it('embeds an image used several times only once', async () => {
    const shared = image('progressive-120x90.jpg', 'shared');
    const pages = withAnnotations({
      0: [
        { id: 'a', type: 'image', rotate: 0, rect: { x: 0, y: 0, width: 120, height: 90 }, image: shared },
        { id: 'b', type: 'image', rotate: 0, rect: { x: 200, y: 0, width: 60, height: 45 }, image: shared },
      ],
      1: [{ id: 'c', type: 'image', rotate: 0, rect: { x: 0, y: 0, width: 120, height: 90 }, image: shared }],
    });
    const out = await build(pages);
    expect(await imagePlacements(pdfjs, out, 1)).toHaveLength(2);
    expect(await imagePlacements(pdfjs, out, 2)).toHaveLength(1);
    const doc = await PDFDocument.load(out);
    const imageRefs = new Set(
      doc.getPages().flatMap((p) => p.node.Resources().lookup(PDFName.of('XObject'), PDFDict).values().map(String))
    );
    expect(imageRefs.size).toBe(1);
  });
});
