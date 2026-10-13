// @vitest-environment node
// Real pdf-lib + pdf.js (no mocks): pdf.js text extraction proves the
// exported pages still carry real text objects, i.e. text is selectable.
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import {
  buildPdf,
  exportFileName,
  ExportError,
  extractFileName,
} from '../src/lib/exportPdf.js';
import { parsePageRanges } from '../src/lib/pageRanges.js';
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

/** Wrap single-file bytes as the sources map buildPdf expects. */
const src = (bytes, name = 'fixture.pdf') => ({ s1: { name, bytes } });
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
    const out = await buildPdf(src(sourceBytes), createPageModel(4));
    expect(await describePages(out)).toEqual(
      SOURCE.map((s) => ({ size: s.size, rotate: s.rotate }))
    );
    expect(await extractText(out)).toEqual(SOURCE.map((s) => s.text));
  });

  it('applies reorder, rotation (on top of intrinsic /Rotate) and deletion', async () => {
    let pages = createPageModel(4); // p1..p4
    pages = movePages(pages, ['s1-4'], 0); // 4,1,2,3
    pages = rotatePages(pages, ['s1-1'], 90); // p1 → 90
    pages = rotatePages(pages, ['s1-3'], -90); // p3 intrinsic 90 → 0
    pages = deletePages(pages, ['s1-2']); // 4,1,3

    const out = await buildPdf(src(sourceBytes), pages);

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
    const out = await buildPdf(src(sourceBytes), createPageModel(4));
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
    await buildPdf(src(sourceBytes), rotatePages(createPageModel(4), ['s1-1'], 90));
    expect(sourceBytes).toEqual(before);
  });

  it('carries over document metadata', async () => {
    const out = await PDFDocument.load(await buildPdf(src(sourceBytes), createPageModel(4)));
    expect(out.getTitle()).toBe('Fixture document');
    expect(out.getAuthor()).toBe('DocuSync tests');
  });

  it('rejects an empty model and unreadable input with ExportError', async () => {
    await expect(buildPdf(src(sourceBytes), [])).rejects.toBeInstanceOf(ExportError);
    await expect(
      buildPdf(src(new TextEncoder().encode('not a pdf')), createPageModel(1))
    ).rejects.toBeInstanceOf(ExportError);
  });
});

describe('extract (split)', () => {
  let sourceBytes;

  beforeAll(async () => {
    pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    sourceBytes = await makeSourcePdf();
  });

  // Mirrors DocumentContext.extractPages: positions → model entries → buildPdf.
  const extract = (pages, rangeText) => {
    const { pages: positions } = parsePageRanges(rangeText, pages.length);
    return buildPdf(src(sourceBytes), positions.map((n) => pages[n - 1]));
  };

  it('extracts exactly the pages in a range, with text intact', async () => {
    const out = await extract(createPageModel(4), '2-3');
    expect(await describePages(out)).toEqual([
      { size: [612, 792], rotate: 0 },
      { size: [500, 700], rotate: 90 },
    ]);
    expect(await extractText(out)).toEqual(['Bravo page two', 'Charlie page three']);
  });

  it('extracts a mixed list in document order', async () => {
    const out = await extract(createPageModel(4), '4, 1');
    expect(await extractText(out)).toEqual(['Alpha page one', 'Delta page four']);
  });

  it('uses edited positions and keeps edits (reorder + rotation)', async () => {
    let pages = movePages(createPageModel(4), ['s1-4'], 0); // 4,1,2,3
    pages = rotatePages(pages, ['s1-1'], 180);
    const out = await extract(pages, '1-2'); // source 4, then source 1 rotated
    expect(await describePages(out)).toEqual([
      { size: [420, 595], rotate: 0 },
      { size: [595, 842], rotate: 180 },
    ]);
    expect(await extractText(out)).toEqual(['Delta page four', 'Alpha page one']);
  });
});

describe('merge', () => {
  let a;
  let b;

  // A second document with its own font and metadata.
  async function makeSecondPdf() {
    const doc = await PDFDocument.create();
    doc.setTitle('Second document');
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    for (const [text, size] of [
      ['Echo extra one', [300, 400]],
      ['Foxtrot extra two', [350, 450]],
    ]) {
      const page = doc.addPage(size);
      page.drawText(text, { x: 30, y: size[1] - 60, size: 16, font });
    }
    return doc.save();
  }

  beforeAll(async () => {
    pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    a = await makeSourcePdf();
    b = await makeSecondPdf();
  });

  const sources = () => ({
    s1: { name: 'a.pdf', bytes: a },
    s2: { name: 'b.pdf', bytes: b },
  });

  it('appends a second document after the first', async () => {
    const pages = [...createPageModel(4, 's1'), ...createPageModel(2, 's2')];
    const out = await buildPdf(sources(), pages);
    expect(await extractText(out)).toEqual([
      'Alpha page one',
      'Bravo page two',
      'Charlie page three',
      'Delta page four',
      'Echo extra one',
      'Foxtrot extra two',
    ]);
  });

  it('interleaves pages across documents, keeping rotations and deletions', async () => {
    let pages = [...createPageModel(4, 's1'), ...createPageModel(2, 's2')];
    pages = movePages(pages, ['s2-2'], 0); // Foxtrot first
    pages = movePages(pages, ['s2-1'], 2); // Echo between Alpha and Bravo
    pages = rotatePages(pages, ['s2-1'], 90);
    pages = deletePages(pages, ['s1-3', 's1-4']);

    const out = await buildPdf(sources(), pages);
    expect(await describePages(out)).toEqual([
      { size: [350, 450], rotate: 0 },
      { size: [595, 842], rotate: 0 },
      { size: [300, 400], rotate: 90 },
      { size: [612, 792], rotate: 0 },
    ]);
    expect(await extractText(out)).toEqual([
      'Foxtrot extra two',
      'Alpha page one',
      'Echo extra one',
      'Bravo page two',
    ]);
  });

  it('takes metadata from the document supplying the first page', async () => {
    const pages = [...createPageModel(2, 's2'), ...createPageModel(1, 's1')];
    const out = await PDFDocument.load(await buildPdf(sources(), pages));
    expect(out.getTitle()).toBe('Second document');
  });

  it('only reads the sources that are used', async () => {
    const out = await buildPdf(
      { s1: { name: 'a.pdf', bytes: a } }, // s2 not provided, not needed
      createPageModel(2, 's1')
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('names the failing file when merging', async () => {
    const pages = [...createPageModel(1, 's1'), ...createPageModel(1, 's2')];
    await expect(
      buildPdf(
        { ...sources(), s2: { name: 'b.pdf', bytes: new TextEncoder().encode('junk') } },
        pages
      )
    ).rejects.toThrow('Couldn’t read “b.pdf” for export.');
  });
});

describe('extractFileName', () => {
  it('names the file after the extracted ranges', () => {
    expect(extractFileName('report.pdf', [2, 3, 4, 7])).toBe('report-pages-2-4_7.pdf');
    expect(extractFileName('report.pdf', [5])).toBe('report-page-5.pdf');
  });

  it('falls back to -extract for long range lists', () => {
    const scattered = Array.from({ length: 30 }, (_, i) => i * 2 + 1);
    expect(extractFileName('report.pdf', scattered)).toBe('report-extract.pdf');
  });
});

describe('exportFileName', () => {
  it('appends -edited before the extension', () => {
    expect(exportFileName('report.pdf')).toBe('report-edited.pdf');
    expect(exportFileName('Scan.PDF')).toBe('Scan-edited.pdf');
    expect(exportFileName('notes')).toBe('notes-edited.pdf');
    expect(exportFileName('')).toBe('document-edited.pdf');
    expect(exportFileName('report.pdf', { merged: true })).toBe('report-merged.pdf');
  });
});
