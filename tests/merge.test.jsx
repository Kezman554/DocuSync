import {
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  extraPdfs,
  fakePdf,
  lastRotation,
  openPdf,
  setupDom,
  sidebarOrder,
  thumb,
} from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { default: App } = await import('../src/App.jsx');

// Real PDFs whose page counts match the pdf.js fakes (4 and 2), with distinct
// page sizes so every page can be identified in the exported bytes.
const A = [
  [595, 842],
  [612, 792],
  [500, 700],
  [420, 595],
];
const B = [
  [300, 400],
  [350, 450],
];

async function realPdf(name, sizes) {
  const doc = await PDFDocument.create();
  sizes.forEach((size) => doc.addPage(size));
  return new File([await doc.save()], name, { type: 'application/pdf' });
}

async function addPdf(user, file) {
  await user.upload(screen.getByLabelText('Add PDF files'), file);
}

async function exportedSizes() {
  await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
  const [bytes, fileName] = downloadBytes.mock.calls[0];
  const doc = await PDFDocument.load(bytes);
  return {
    fileName,
    sizes: doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]),
  };
}

/** Drag thumbnail at `from` so it lands before the thumbnail at `onto`. */
function dragBefore(from, onto) {
  const dt = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  const target = thumb(onto).closest('li');
  fireEvent.dragStart(thumb(from), { dataTransfer: dt });
  const over = createEvent.dragOver(target, { dataTransfer: dt });
  Object.defineProperty(over, 'clientY', { value: 0 });
  fireEvent(target, over);
  fireEvent.drop(target, { dataTransfer: dt });
  fireEvent.dragEnd(thumb(1), { dataTransfer: dt });
}

describe('merge', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('appends another PDF’s pages, selects them and labels their source', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdf('sample.pdf', A));

    await addPdf(user, await realPdf('extra.pdf', B));
    await screen.findByText('Page 5 of 6');

    expect(screen.getByText(/sample\.pdf \+ 1 more/)).toBeInTheDocument();
    expect(thumb(1)).toHaveAccessibleName('Page 1, from sample.pdf');
    expect(thumb(5)).toHaveAccessibleName('Page 5, from extra.pdf');
    expect(thumb(5)).toHaveAttribute('aria-pressed', 'true');
    expect(thumb(6)).toHaveAttribute('aria-pressed', 'true');
    // The viewer and thumbnails render from the added document's pages.
    await waitFor(() => {
      expect(lastRotation(1, 'extra.pdf')).toBe(0);
      expect(lastRotation(2, 'extra.pdf')).toBe(0);
    });
  });

  it('reorders across documents and exports the merged result in order', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdf('sample.pdf', A));
    await addPdf(user, await realPdf('extra.pdf', B));
    await screen.findByText('Page 5 of 6');

    // extra.pdf page 1 → between sample pages 1 and 2.
    await user.click(thumb(5));
    dragBefore(5, 2);
    expect(sidebarOrder()).toEqual([1, 1, 2, 3, 4, 2]);
    expect(thumb(2)).toHaveAccessibleName('Page 2, from extra.pdf');

    // Rotate it, and delete sample page 4 (now position 5).
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    await user.click(thumb(5));
    await user.keyboard('{Delete}');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete page',
      })
    );

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const { fileName, sizes } = await exportedSizes();
    expect(fileName).toBe('sample-merged.pdf');
    expect(sizes).toEqual([A[0], B[0], A[1], A[2], B[1]]);

    const [bytes] = downloadBytes.mock.calls[0];
    const rotations = (await PDFDocument.load(bytes))
      .getPages()
      .map((p) => p.getRotation().angle);
    expect(rotations).toEqual([0, 90, 0, 0, 0]);
  });

  it('exports with the -edited name once no merged pages remain', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdf('sample.pdf', A));
    await addPdf(user, await realPdf('extra.pdf', B));
    await screen.findByText('Page 5 of 6');

    // The two added pages are selected — delete them.
    await user.click(screen.getByRole('button', { name: 'Delete 2 pages' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete 2 pages',
      })
    );
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const { fileName, sizes } = await exportedSizes();
    expect(fileName).toBe('sample-edited.pdf');
    expect(sizes).toEqual(A);
  });

  it('adds PDFs dropped onto an open document', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdf('sample.pdf', A));

    const file = await realPdf('extra.pdf', B);
    fireEvent.drop(document.querySelector('.dropzone'), {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    await screen.findByText('Page 5 of 6');
    expect(sidebarOrder()).toEqual([1, 2, 3, 4, 1, 2]);
  });

  it('reports a file that fails to load and keeps the document intact', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdf('sample.pdf', A));

    await addPdf(user, new File(['junk'], 'broken.pdf', { type: 'application/pdf' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t open “broken.pdf”: Invalid PDF structure');
    expect(screen.getByText('Page 1 of 4')).toBeInTheDocument();
    expect(sidebarOrder()).toEqual([1, 2, 3, 4]);
  });

  it('releases every loaded document on close', async () => {
    const user = userEvent.setup();
    fakePdf.destroy.mockClear();
    extraPdfs['extra.pdf'].destroy.mockClear();
    await openPdf(App, user, await realPdf('sample.pdf', A));
    await addPdf(user, await realPdf('extra.pdf', B));
    await screen.findByText('Page 5 of 6');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(fakePdf.destroy).toHaveBeenCalled();
    expect(extraPdfs['extra.pdf'].destroy).toHaveBeenCalled();
  });
});
