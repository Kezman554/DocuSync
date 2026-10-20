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
// A shared field's value also shows on the kept page, so it isn't page 2's to hide.
const SHARED_VALUE = 'SHARED-FIELD-VALUE';

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
    field.setText(SHARED_VALUE);
    field.addToPage(pages[0], { x: 72, y: 600, width: 200, height: 24 });
    field.addToPage(pages[1], { x: 72, y: 600, width: 200, height: 24 });
    // Page 2's widget is pruned from the field; the field stays on page 1.
    return { bytes: await doc.save(), words: [BODY], keepsField: 'shared' };
  },
};

const src = (bytes) => ({ s1: { name: 'routes.pdf', bytes } });

/** pdf.js's view of page `n`'s fields: { name: value }. */
async function fieldsOnPage(bytes, n) {
  const pdf = await loadPdf(bytes);
  const annots = await (await pdf.getPage(n)).getAnnotations();
  await pdf.destroy();
  return Object.fromEntries(annots.filter((a) => a.fieldName).map((a) => [a.fieldName, a.fieldValue]));
}

/**
 * The field named `name` (its /T) as stored in the file: each widget's page,
 * on-state and /AS, the /Opt labels, and /V.
 */
async function fieldDict(bytes, name) {
  const doc = await PDFDocument.load(bytes);
  const { context } = doc;
  const pageRefs = doc.getPages().map((p) => p.ref);
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('T'))?.decodeText?.() !== name) {
      continue;
    }
    const kids = context.lookup(object.get(PDFName.of('Kids')))?.asArray() ?? [];
    const opt = context.lookup(object.get(PDFName.of('Opt')))?.asArray() ?? [];
    const value = object.get(PDFName.of('V'));
    return {
      kids: kids.map((ref) => {
        const kid = context.lookup(ref);
        // Buttons have a dict of states under /AP /N; text fields one stream.
        const states = context.lookup(context.lookup(kid.get(PDFName.of('AP'))).get(PDFName.of('N')));
        return {
          page: pageRefs.indexOf(kid.get(PDFName.of('P'))) + 1,
          on:
            states instanceof PDFDict
              ? states.keys().map((k) => k.decodeText()).find((k) => k !== 'Off')
              : undefined,
          as: kid.get(PDFName.of('AS'))?.decodeText(),
        };
      }),
      opt: opt.map((o) => o.decodeText()),
      value: value?.decodeText?.() ?? value?.toString(),
    };
  }
  return null;
}

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
    if (fixture.keepsField) {
      // …and so is the shared field, on page 1 only, with its value.
      expect(await fieldsOnPage(out, 1)).toEqual({ [fixture.keepsField]: SHARED_VALUE });
      expect((await fieldDict(out, fixture.keepsField)).kids).toHaveLength(1);
    }
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

describe('radio groups and nested fields across a left-out page', () => {
  /** A radio group "pick" with one option per page, labelled after its page. */
  async function radioOnThreePages(selected) {
    const { doc, pages } = await threePages();
    const group = doc.getForm().createRadioGroup('pick');
    const labels = ['OPTION-ON-PAGE-1', 'OPTION-ON-PAGE-2', 'OPTION-ON-PAGE-3'];
    labels.forEach((label, i) =>
      group.addOptionToPage(label, pages[i], { x: 72, y: 600, width: 20, height: 20 })
    );
    group.select(labels[selected]);
    return doc.save();
  }

  const deletePage = (bytes, n) => {
    const model = createPageModel(3);
    return buildPdf(src(bytes), deletePages(model, [model[n - 1].id]));
  };

  /** pdf.js: for each page, whether its "pick" widget is the selected one. */
  async function selection(bytes) {
    const pdf = await loadPdf(bytes);
    const out = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const annots = await (await pdf.getPage(n)).getAnnotations();
      const radio = annots.find((a) => a.fieldName === 'pick');
      out.push(radio ? radio.fieldValue === radio.buttonValue : null);
    }
    await pdf.destroy();
    return out;
  }

  it('renumbers options after an earlier one is removed (page 1 deleted, page 3 chosen)', async () => {
    const before = await radioOnThreePages(2);
    // pdf-lib names states by /Opt position: the three widgets are "0", "1", "2".
    expect((await fieldDict(before, 'pick')).kids.map((k) => k.on)).toEqual(['0', '1', '2']);

    const out = await deletePage(before, 1);
    expect(await fieldDict(out, 'pick')).toEqual({
      // One widget per remaining page, renamed to its new position…
      kids: [
        { page: 1, on: '0', as: 'Off' },
        { page: 2, on: '1', as: '1' },
      ],
      // …/Opt lined up with /Kids…
      opt: ['OPTION-ON-PAGE-2', 'OPTION-ON-PAGE-3'],
      // …and the old page 3's option is still the selected one.
      value: '1',
    });
    // pdf.js agrees: the widget from page 3 (now page 2) is the selected one.
    expect(await selection(out)).toEqual([false, true]);
    expect(await fileContains(out, 'OPTION-ON-PAGE-1')).toBe(false);
  });

  it('clears the choice when the selected option was on the left-out page', async () => {
    const out = await deletePage(await radioOnThreePages(1), 2);
    const field = await fieldDict(out, 'pick');
    // Not "1": after renumbering that name belongs to page 3's option.
    expect(field.value).toBe('Off');
    expect(field.opt).toEqual(['OPTION-ON-PAGE-1', 'OPTION-ON-PAGE-3']);
    expect(field.kids.map((k) => k.as)).toEqual(['Off', 'Off']);
    expect(await selection(out)).toEqual([false, false]);
    expect(await fileContains(out, 'OPTION-ON-PAGE-2')).toBe(false);
  });

  it('keeps the choice when only a later, unselected option is removed', async () => {
    const out = await deletePage(await radioOnThreePages(0), 3);
    expect(await fieldDict(out, 'pick')).toEqual({
      kids: [
        { page: 1, on: '0', as: '0' },
        { page: 2, on: '1', as: 'Off' },
      ],
      opt: ['OPTION-ON-PAGE-1', 'OPTION-ON-PAGE-2'],
      value: '0',
    });
    expect(await selection(out)).toEqual([true, false]);
  });

  it('removes a sub-field left with no widgets from its parent', async () => {
    const { doc, pages } = await threePages();
    const form = doc.getForm();
    const child = form.createTextField('group.child'); // only on the left-out page
    child.setText('CHILD-ON-PAGE-2');
    child.addToPage(pages[1], { x: 72, y: 600, width: 200, height: 24 });
    const other = form.createTextField('group.other');
    other.setText('OTHER-KEPT');
    other.addToPage(pages[0], { x: 72, y: 600, width: 200, height: 24 });

    const out = await deletePage(await doc.save(), 2);
    // Reachable through other → group → /Kids if the emptied child stayed.
    expect(await fileContains(out, 'CHILD-ON-PAGE-2')).toBe(false);
    expect(await fieldsOnPage(out, 1)).toEqual({ 'group.other': 'OTHER-KEPT' });
    expect(await fileContains(out, BODY)).toBe(false);
  });
});
