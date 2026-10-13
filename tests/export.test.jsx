import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { fakePdf: pdf } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async () => pdf) };
});

// Capture the exported bytes instead of triggering a browser download.
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { default: App } = await import('../src/App.jsx');

// Real 4-page PDF (matching the fake pdf.js page count) with distinct sizes
// so each source page can be identified in the export.
const SIZES = [
  [595, 842],
  [612, 792],
  [500, 700],
  [420, 595],
];

async function realPdfFile() {
  const doc = await PDFDocument.create();
  SIZES.forEach((size) => doc.addPage(size));
  const bytes = await doc.save();
  return new File([bytes], 'sample.pdf', { type: 'application/pdf' });
}

async function exportedPages() {
  await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
  const [bytes, fileName] = downloadBytes.mock.calls[0];
  const doc = await PDFDocument.load(bytes);
  return {
    fileName,
    pages: doc.getPages().map((p) => ({
      size: [Math.round(p.getWidth()), Math.round(p.getHeight())],
      rotate: p.getRotation().angle,
    })),
  };
}

describe('export', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('exports the edited page order, rotations and deletions', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdfFile());

    // Move page 4 to the top.
    await user.click(thumb(4));
    await user.keyboard('{Alt>}{ArrowUp}{ArrowUp}{ArrowUp}{/Alt}');
    // Rotate source page 1 (now at position 2) right.
    await user.click(thumb(2));
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    // Delete source page 2 (now at position 3).
    await user.click(thumb(3));
    await user.keyboard('{Delete}');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete page',
      })
    );

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const { fileName, pages } = await exportedPages();

    expect(fileName).toBe('sample-edited.pdf');
    expect(pages).toEqual([
      { size: SIZES[3], rotate: 0 },
      { size: SIZES[0], rotate: 90 },
      { size: SIZES[2], rotate: 0 },
    ]);
    // The app's model is untouched by exporting; it can be exported again.
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
  });

  it('shows a dismissible error if the file can’t be re-read as a PDF', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openPdf(App, user); // default helper file is not a real PDF

    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t read the original PDF for export.');
    expect(downloadBytes).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('extract pages (split)', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  const openExtract = async (user) => {
    await user.click(screen.getByRole('button', { name: 'Extract pages…' }));
    const dialog = screen.getByRole('dialog', { name: 'Extract pages' });
    return { dialog, input: within(dialog).getByLabelText(/^Pages/) };
  };

  it('pre-fills the sidebar selection and extracts it', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdfFile());

    await user.click(thumb(2));
    await user.keyboard('{Shift>}');
    await user.click(thumb(3));
    await user.keyboard('{/Shift}');

    const { dialog, input } = await openExtract(user);
    expect(input).toHaveValue('2-3');
    expect(input).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Extract 2 pages' }));

    const { fileName, pages } = await exportedPages();
    expect(fileName).toBe('sample-pages-2-3.pdf');
    expect(pages).toEqual([
      { size: SIZES[1], rotate: 0 },
      { size: SIZES[2], rotate: 0 },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('extracts a typed range list on Enter', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdfFile());

    const { input } = await openExtract(user);
    expect(input).toHaveValue('1'); // current page when nothing else selected
    await user.clear(input);
    await user.type(input, '4, 1-2{Enter}');

    const { fileName, pages } = await exportedPages();
    expect(fileName).toBe('sample-pages-1-2_4.pdf');
    expect(pages.map((p) => p.size)).toEqual([SIZES[0], SIZES[1], SIZES[3]]);
  });

  it('blocks invalid ranges with an explanation', async () => {
    const user = userEvent.setup();
    await openPdf(App, user, await realPdfFile());

    const { dialog, input } = await openExtract(user);
    await user.clear(input);
    await user.type(input, '3-9');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'There’s no page 9 — this document has 4 pages'
    );
    const extractBtn = within(dialog).getByRole('button', { name: /^Extract/ });
    expect(extractBtn).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(downloadBytes).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Extracting doesn't touch the document being edited.
    expect(screen.getByText('Page 1 of 4')).toBeInTheDocument();
  });
});
