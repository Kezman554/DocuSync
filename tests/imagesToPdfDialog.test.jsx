import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { openPdf, setupDom } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)), loadPdfData: vi.fn() };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { downloadBytes } = await import('../src/lib/download.js');
const { default: App } = await import('../src/App.jsx');

const file = (path, name, type) => new File([readFileSync(resolve('tests/fixtures', path))], name, { type });
const PHOTO = () => file('photo-400x300.jpg', 'photo.jpg', 'image/jpeg');
const LOGO = () => file('logo-200x100.png', 'logo.png', 'image/png');
const SIDEWAYS = () => file('exif/orient-6.jpg', 'phone.jpg', 'image/jpeg'); // stored 90×120
const GIF = () => file('not-supported.gif', 'anim.gif', 'image/gif');

/** Each page's size and its image's stored pixel size, from the PDF bytes. */
async function describePdf(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const xobjects = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const img = doc.context.lookup(xobjects.values()[0]);
    return {
      page: [Math.round(page.getWidth()), Math.round(page.getHeight())],
      image: [img.dict.get(PDFName.of('Width')).asNumber(), img.dict.get(PDFName.of('Height')).asNumber()],
    };
  });
}

async function openFromEmptyState(user, files) {
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Create PDF from images' }));
  await user.upload(screen.getByLabelText('Choose images'), files);
  return screen.findByRole('dialog', { name: 'Create a PDF from images' });
}

const list = (dialog) => within(dialog).getByRole('list', { name: 'Images, in page order' });
const names = (dialog) =>
  within(list(dialog))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.images-pdf__name').textContent);

describe('create a PDF from images', () => {
  beforeEach(() => {
    setupDom();
    downloadBytes.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists the images, skips unreadable ones, and downloads one page per image in order', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const dialog = await openFromEmptyState(user, [PHOTO(), LOGO(), SIDEWAYS(), GIF()]);

    await waitFor(() => expect(within(dialog).queryByText('Reading…')).toBeNull());
    expect(within(dialog).getByText('Skipped — isn’t an image this browser can read')).toBeInTheDocument();
    // The phone photo is listed as it's meant to be seen (landscape).
    expect(within(dialog).getByText('120 × 90 px')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create PDF (3 pages)' })).toBeEnabled();

    // Reorder: logo first; drop the GIF.
    await user.click(within(dialog).getByRole('button', { name: 'Move logo.png up' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove anim.gif' }));
    expect(names(dialog)).toEqual(['logo.png', 'photo.jpg', 'phone.jpg']);

    // jsdom's locale is en-US → Letter by default.
    expect(within(dialog).getByLabelText('Page size')).toHaveValue('letter');
    await user.selectOptions(within(dialog).getByLabelText('Then'), 'download');
    await user.click(within(dialog).getByRole('button', { name: 'Create PDF (3 pages)' }));

    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const [bytes, name] = downloadBytes.mock.calls[0];
    expect(name).toBe('images.pdf');
    expect(await describePdf(bytes)).toEqual([
      { page: [792, 612], image: [200, 100] }, // landscape image → landscape Letter
      { page: [792, 612], image: [400, 300] },
      { page: [792, 612], image: [90, 120] }, // stored sideways, shown landscape
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the new PDF for editing when no document is open', async () => {
    const user = userEvent.setup();
    const dialog = await openFromEmptyState(user, [PHOTO()]);
    await waitFor(() => expect(within(dialog).getByText('400 × 300 px')).toBeInTheDocument());
    expect(within(dialog).getByLabelText('Then')).toHaveValue('open');
    expect(within(dialog).getByLabelText('File name')).toHaveValue('photo');
    await user.clear(within(dialog).getByLabelText('File name'));
    await user.type(within(dialog).getByLabelText('File name'), 'images');
    await user.click(within(dialog).getByRole('button', { name: 'Create PDF (1 page)' }));

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument(); // fake pdf.js for images.pdf
    expect(screen.getByText('images.pdf')).toBeInTheDocument(); // toolbar file name
  });

  it('adds the pages to the open document from the toolbar', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.upload(screen.getByLabelText('Choose images for a new PDF'), [PHOTO(), LOGO()]);
    const dialog = await screen.findByRole('dialog', { name: 'Create a PDF from images' });
    await waitFor(() => expect(within(dialog).queryByText('Reading…')).toBeNull());
    expect(within(dialog).getByLabelText('Then')).toHaveValue('add');
    await user.click(within(dialog).getByRole('button', { name: 'Create PDF (2 pages)' }));
    expect(await screen.findByText('Page 5 of 6')).toBeInTheDocument(); // 4 + 2, new pages shown
  });

  it('opens from dropped images, and fit-to-image disables margins', async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.drop(document.querySelector('.dropzone'), {
      dataTransfer: { files: [LOGO()], types: ['Files'] },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Create a PDF from images' });
    await waitFor(() => expect(within(dialog).getByText('200 × 100 px')).toBeInTheDocument());

    await user.selectOptions(within(dialog).getByLabelText('Page size'), 'fit');
    expect(within(dialog).getByLabelText('Margins')).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('Then'), 'download');
    await user.click(within(dialog).getByRole('button', { name: 'Create PDF (1 page)' }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(await describePdf(downloadBytes.mock.calls[0][0])).toEqual([
      { page: [150, 75], image: [200, 100] }, // 96 dpi: 0.75 pt per px
    ]);
  });

  it('can’t create a PDF with nothing readable', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const dialog = await openFromEmptyState(user, [GIF()]);
    await waitFor(() => expect(within(dialog).getByText(/^Skipped/)).toBeInTheDocument());
    expect(within(dialog).getByRole('button', { name: 'Create PDF' })).toBeDisabled();
  });
});
