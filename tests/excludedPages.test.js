// @vitest-environment node
// Pages the user deleted, or left out of an extract, must not reach the
// file through references from the pages that are kept. pdf-lib's copyPages
// follows every reference: a link's /Dest, a reply's /IRT, a form field's
// /Kids. Checked with the strict search (extraction plus every object and
// decoded stream, plain/hex/UTF-16BE).
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { buildPdf } from '../src/lib/exportPdf.js';
import { compressPdf } from '../src/lib/compress.js';
import { createPageModel, deletePages } from '../src/lib/pageModel.js';
import { extractedText, fileContains, leaks } from './helpers/pdfSearch.js';

let pdfjs;
const loadPdf = (bytes) =>
  pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
const leaked = (bytes, word) => leaks(loadPdf, bytes, word);

beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

const BODY = 'EXCLUDED-BODY-TEXT';
const COMMENT = 'EXCLUDED-COMMENT';
const FIELD = 'EXCLUDED-FIELD-VALUE';

/** Three pages; page 2 is the one that gets left out. */
async function threePages() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = ['Kept page one', BODY, 'Kept page three'].map((text) => {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 72, y: 700, size: 14, font });
    return page;
  });
  return { doc, pages };
}

const addAnnots = (doc, page, ...refs) =>
  page.node.set(PDFName.of('Annots'), doc.context.obj([...(page.node.Annots()?.asArray() ?? []), ...refs]));

function link(doc, from, to) {
  addAnnots(
    doc,
    from,
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [72, 650, 300, 680],
        Border: [0, 0, 0],
        Dest: [to.ref, PDFName.of('Fit')],
        P: from.ref,
      })
    )
  );
}

/** Each route from page 1 into page 2, as its own fixture. */
const ROUTES = {
  async link() {
    const { doc, pages } = await threePages();
    link(doc, pages[0], pages[1]);
    return { bytes: await doc.save(), words: [BODY] };
  },
  async 'comment reply'() {
    const { doc, pages } = await threePages();
    const comment = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [300, 600, 320, 620],
        Contents: PDFString.of(COMMENT),
        P: pages[1].ref,
      })
    );
    addAnnots(doc, pages[1], comment);
    const reply = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [300, 600, 320, 620],
        Contents: PDFString.of('A kept reply'),
        IRT: comment,
        P: pages[0].ref,
      })
    );
    addAnnots(doc, pages[0], reply);
    return { bytes: await doc.save(), words: [BODY, COMMENT] };
  },
  async 'shared form field'() {
    const { doc, pages } = await threePages();
    const field = doc.getForm().createTextField('shared');
    field.setText(FIELD);
    field.addToPage(pages[0], { x: 72, y: 600, width: 200, height: 24 });
    field.addToPage(pages[1], { x: 72, y: 600, width: 200, height: 24 });
    return { bytes: await doc.save(), words: [BODY, FIELD] };
  },
};

const src = (bytes) => ({ s1: { name: 'routes.pdf', bytes } });

/** The two ways a page is left out: deleted before Export PDF, or not extracted. */
const MODES = {
  'Export PDF with page 2 deleted': (bytes) => {
    const model = createPageModel(3);
    return buildPdf(src(bytes), deletePages(model, [model[1].id]));
  },
  'Extract pages without page 2 (page 1 only)': (bytes) =>
    buildPdf(src(bytes), [createPageModel(3)[0]]),
};

describe.each(Object.keys(ROUTES))('route: %s', (route) => {
  let fixture;
  beforeAll(async () => {
    fixture = await ROUTES[route]();
  });

  it('control: exporting every page carries the words (the search finds them)', async () => {
    const all = await buildPdf(src(fixture.bytes), createPageModel(3));
    for (const word of fixture.words) expect(await leaked(all, word)).toBe(true);
  });

  it.each(Object.keys(MODES))('%s: nothing of page 2 reaches the file', async (mode) => {
    const out = await MODES[mode](fixture.bytes);
    const text = await extractedText(loadPdf, out);
    // Every word, both checks, in one comparison: a failure shows them all.
    const found = {};
    for (const word of fixture.words) {
      found[word] = { extracted: text.includes(word), inFile: await fileContains(out, word) };
    }
    expect(found).toEqual(
      Object.fromEntries(fixture.words.map((w) => [w, { extracted: false, inFile: false }]))
    );
    // The kept pages are still there.
    expect(await extractedText(loadPdf, out)).toContain('Kept page one');
  });
});

describe('what must keep working', () => {
  /** Number of page objects in the file (a stray copy would be one more). */
  async function pageObjects(bytes) {
    const doc = await PDFDocument.load(bytes);
    return [...doc.context.enumerateIndirectObjects()].filter(
      ([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/Page'
    ).length;
  }

  it('a link between two kept pages still points at the right page', async () => {
    const { doc, pages } = await threePages();
    link(doc, pages[0], pages[2]);
    const model = createPageModel(3);
    for (const out of [
      await buildPdf(src(await doc.save()), deletePages(model, [model[1].id])),
      await buildPdf(src(await doc.save()), [model[0], model[2]]),
    ]) {
      const pdf = await loadPdf(out);
      const [linkAnnot] = (await (await pdf.getPage(1)).getAnnotations()).filter(
        (a) => a.subtype === 'Link'
      );
      expect(await pdf.getPageIndex(linkAnnot.dest[0])).toBe(1); // page 3, now second
      await pdf.destroy();
      expect(await pageObjects(out)).toBe(2); // no stray copy of the target
      expect(await fileContains(out, BODY)).toBe(false);
    }
  });

  it('a field whose widgets are all on kept pages keeps its value', async () => {
    const { doc, pages } = await threePages();
    const field = doc.getForm().createTextField('kept');
    field.setText('KEPT-FIELD-VALUE');
    field.addToPage(pages[0], { x: 72, y: 600, width: 200, height: 24 });
    field.addToPage(pages[2], { x: 72, y: 600, width: 200, height: 24 });
    const model = createPageModel(3);
    const out = await buildPdf(src(await doc.save()), deletePages(model, [model[1].id]));

    const pdf = await loadPdf(out);
    for (const n of [1, 2]) {
      const annots = await (await pdf.getPage(n)).getAnnotations();
      expect(annots.find((a) => a.fieldName === 'kept')?.fieldValue).toBe('KEPT-FIELD-VALUE');
    }
    await pdf.destroy();
    expect(await fileContains(out, BODY)).toBe(false);
  });
});

describe('other paths that write a PDF', () => {
  it('Compress works on the export, so it carries no more than the export', async () => {
    const { bytes } = await ROUTES.link();
    const model = createPageModel(3);
    const exported = await buildPdf(src(bytes), deletePages(model, [model[1].id]));
    const { bytes: compressed } = await compressPdf(
      exported,
      { quality: 0.7, maxSide: 2000, stripMetadata: false },
      async () => null
    );
    expect(await fileContains(compressed, BODY)).toBe(false);
    expect(await extractedText(loadPdf, compressed)).toContain('Kept page one');
  });
});

describe('formFields helpers (which fields an export drops)', () => {
  it('lists the pages of fields spread over several pages, ignoring parents', async () => {
    const { sharedFieldPages } = await import('../src/lib/formFields.js');
    expect(sharedFieldPages(null)).toEqual([]);
    const pages = sharedFieldPages({
      shared: [{ page: -1 }, { page: 0 }, { page: 1 }],
      single: [{ page: -1 }, { page: 2 }],
      twiceOnOnePage: [{ page: 3 }, { page: 3 }],
    });
    expect(pages.map((set) => [...set])).toEqual([[0, 1]]);
  });

  it('says a field is dropped only when it’s on a kept page and a left-out one', async () => {
    const { dropsSharedField } = await import('../src/lib/formFields.js');
    const fields = { s1: [new Set([0, 1])] };
    const entries = (...sourcePages) => sourcePages.map((n) => ({ sourceId: 's1', sourcePage: n }));
    expect(dropsSharedField(entries(1, 3), fields)).toBe(true); // page 2 left out
    expect(dropsSharedField(entries(1, 2, 3), fields)).toBe(false);
    expect(dropsSharedField(entries(3), fields)).toBe(false); // the whole field is gone anyway
    expect(dropsSharedField(entries(1, 3), {})).toBe(false); // no field info
  });

  it('agrees with pdf.js on a real file', async () => {
    const { sharedFieldPages } = await import('../src/lib/formFields.js');
    const { bytes } = await ROUTES['shared form field']();
    const pdf = await loadPdf(bytes);
    expect(sharedFieldPages(await pdf.getFieldObjects()).map((s) => [...s])).toEqual([[0, 1]]);
    await pdf.destroy();
  });
});
