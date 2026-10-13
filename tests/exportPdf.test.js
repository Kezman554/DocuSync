// @vitest-environment node
// Real pdf-lib + pdf.js (no mocks): pdf.js text extraction proves the
// exported pages still carry real text objects, i.e. text is selectable.
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import { buildPdf, exportFileName, ExportError } from '../src/lib/exportPdf.js';
import { createPageModel, deletePages, movePages, rotatePages } from '../src/lib/pageModel.js';

// Distinct sizes make each source page identifiable in the output.
const SOURCE = [
  { text: 'Alpha page one', size: [595, 842], rotate: 0 },
  { text: 'Bravo page two', size: [612, 792], rotate: 0 },
  { text: 'Charlie page three', size: [500, 700], rotate: 90 }, // intrinsic /Rotate
  { text: 'Delta page four', size: [420, 595], rotate: 0 },
];

async function makeSourcePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Fixture document');
  doc.setAuthor('DocuSync tests');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const { text, size, rotate } of SOURCE) {
    const page = doc.addPage(size);
    page.drawText(text, { x: 50, y: size[1] - 80, size: 18, font });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}

let pdfjs;
async function extractText(bytes) {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const content = await (await pdf.getPage(i)).getTextContent();
    texts.push(content.items.map((item) => item.str).join('').trim());
  }
  await pdf.destroy();
  return texts;
}

const describePages = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => ({
    size: [Math.round(p.getWidth()), Math.round(p.getHeight())],
    rotate: p.getRotation().angle,
  }));
};

describe('buildPdf', () => {
  let sourceBytes;

  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    sourceBytes = await makeSourcePdf();
  });

  it('round-trips an unedited model unchanged in order, size and text', async () => {
    const out = await buildPdf(sourceBytes, createPageModel(4));
    expect(await describePages(out)).toEqual(
      SOURCE.map((s) => ({ size: s.size, rotate: s.rotate }))
    );
    expect(await extractText(out)).toEqual(SOURCE.map((s) => s.text));
  });

  it('applies reorder, rotation (on top of intrinsic /Rotate) and deletion', async () => {
    let pages = createPageModel(4); // p1..p4
    pages = movePages(pages, ['p4'], 0); // 4,1,2,3
    pages = rotatePages(pages, ['p1'], 90); // p1 → 90
    pages = rotatePages(pages, ['p3'], -90); // p3 intrinsic 90 → 0
    pages = deletePages(pages, ['p2']); // 4,1,3

    const out = await buildPdf(sourceBytes, pages);

    expect(await describePages(out)).toEqual([
      { size: [420, 595], rotate: 0 },
      { size: [595, 842], rotate: 90 },
      { size: [500, 700], rotate: 0 },
    ]);
    // Text survives as real text objects — i.e. still selectable.
    expect(await extractText(out)).toEqual([
      'Delta page four',
      'Alpha page one',
      'Charlie page three',
    ]);
  });

  it('copies pages as objects rather than images', async () => {
    const out = await buildPdf(sourceBytes, createPageModel(4));
    const doc = await PDFDocument.load(out);
    for (const page of doc.getPages()) {
      const resources = page.node.Resources();
      // Text is drawn with fonts…
      expect(resources.lookupMaybe(PDFName.of('Font'), PDFDict)).toBeDefined();
      // …and no page has been flattened into an image XObject.
      const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
      expect(xobjects?.entries() ?? []).toHaveLength(0);
    }
  });

  it('does not modify the source bytes', async () => {
    const before = Uint8Array.from(sourceBytes);
    await buildPdf(sourceBytes, rotatePages(createPageModel(4), ['p1'], 90));
    expect(sourceBytes).toEqual(before);
  });

  it('carries over document metadata', async () => {
    const out = await PDFDocument.load(await buildPdf(sourceBytes, createPageModel(4)));
    expect(out.getTitle()).toBe('Fixture document');
    expect(out.getAuthor()).toBe('DocuSync tests');
  });

  it('rejects an empty model and unreadable input with ExportError', async () => {
    await expect(buildPdf(sourceBytes, [])).rejects.toBeInstanceOf(ExportError);
    await expect(
      buildPdf(new TextEncoder().encode('not a pdf'), createPageModel(1))
    ).rejects.toBeInstanceOf(ExportError);
  });
});

describe('exportFileName', () => {
  it('appends -edited before the extension', () => {
    expect(exportFileName('report.pdf')).toBe('report-edited.pdf');
    expect(exportFileName('Scan.PDF')).toBe('Scan-edited.pdf');
    expect(exportFileName('notes')).toBe('notes-edited.pdf');
    expect(exportFileName('')).toBe('document-edited.pdf');
  });
});
