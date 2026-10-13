import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setupDom } from './helpers/fakePdf.jsx';
import { SIGNATURE, makePhoto } from './helpers/syntheticPhoto.js';
import { createStampStore } from '../src/lib/stampStore.js';
import { pngHasAlpha } from '../src/lib/signature.js';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});

// jsdom can't decode photos or encode PNGs, so those browser steps are stood
// in for: decode returns a synthetic photo (ink on unevenly lit paper),
// encode returns a real transparent PNG and records what it was given. The
// transform between them is the real one. (The real decode/encode were run on
// tests/fixtures/signature-photo.jpg in headless Edge.)
const SIGNATURE_PNG = new Uint8Array(readFileSync(resolve('tests/fixtures/signature-260x90.png')));
let photoFor;
const encoded = [];
vi.mock('../src/lib/photoSignatureBrowser.js', () => ({
  MAX_PHOTO_SIDE: 1600,
  decodePhoto: vi.fn(async (file) => {
    const photo = photoFor(file);
    if (!photo) throw new Error('That photo couldn’t be read. Try a JPG or PNG.');
    return photo;
  }),
  paintPixels: vi.fn(),
  encodePng: vi.fn(async (pixels) => {
    encoded.push(pixels);
    return SIGNATURE_PNG;
  }),
}));

const { default: App } = await import('../src/App.jsx');

const inkPhoto = () =>
  makePhoto({ strokes: SIGNATURE, ink: [35, 50, 125], light: (x) => 1 - 0.4 * (x / 400) }).image;
const blankPhoto = () => makePhoto({ strokes: [] }).image;

async function choosePhoto(user, name = 'my-signature.jpg') {
  await user.click(screen.getByRole('button', { name: 'Stamps' }));
  const panel = screen.getByRole('complementary', { name: 'Stamps' });
  await waitFor(() => expect(within(panel).queryByText('Loading your stamps…')).toBeNull());
  await user.upload(
    within(panel).getByLabelText('Choose signature photo'),
    new File(['jpeg bytes'], name, { type: 'image/jpeg' })
  );
  return { panel, dialog: await screen.findByRole('dialog', { name: 'Signature from a photo' }) };
}

describe('signature from a photo', () => {
  beforeEach(() => {
    setupDom();
    globalThis.indexedDB = new IDBFactory();
    encoded.length = 0;
    photoFor = () => inkPhoto();
  });
  afterEach(() => vi.restoreAllMocks());

  it('previews the extracted signature and saves it as a transparent stamp', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { panel, dialog } = await choosePhoto(user);

    const status = within(dialog).getByRole('status');
    await waitFor(() => expect(status).toHaveTextContent(/^Found ink: \d+ × \d+ px\.$/));
    expect(within(dialog).getByLabelText('Signature preview')).toBeVisible();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('my-signature');

    await user.click(within(dialog).getByRole('button', { name: 'Save signature' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // What was encoded is the transform's output: cropped, transparent paper.
    const [pixels] = encoded;
    expect(pixels.width).toBeLessThan(400);
    expect(pixels.data[3]).toBe(0); // top-left corner transparent
    expect(Math.max(...pixels.data.filter((_, i) => i % 4 === 3))).toBe(255);

    // Saved in the library as a signature stamp with transparency.
    const sigs = within(panel).getByRole('region', { name: 'Signatures' });
    expect(within(sigs).getByRole('button', { name: 'my-signature' })).toBeInTheDocument();
    const [stored] = await createStampStore(globalThis.indexedDB).list();
    expect(stored).toMatchObject({ kind: 'signature', content: { type: 'image', mime: 'image/png' } });
    expect(pngHasAlpha(stored.content.bytes)).toBe(true);
  });

  it('changes ink detection live: faint ink appears only at higher levels', async () => {
    // Faint, pencil-like strokes on unevenly lit paper.
    photoFor = () => makePhoto({ strokes: SIGNATURE, ink: [205, 202, 194], noise: 3 }).image;
    const user = userEvent.setup();
    render(<App />);
    const { dialog } = await choosePhoto(user);
    const status = within(dialog).getByRole('status');
    const slider = within(dialog).getByLabelText('Ink detection');
    const save = within(dialog).getByRole('button', { name: 'Save signature' });
    await waitFor(() => expect(status).toHaveTextContent(/^(Found ink|No ink)/));

    fireEvent.change(slider, { target: { value: '1' } }); // least sensitive
    expect(slider).toHaveAttribute('aria-valuetext', 'Level 1 of 9');
    expect(status).toHaveTextContent('No ink found');
    expect(save).toBeDisabled();

    fireEvent.change(slider, { target: { value: '9' } }); // most sensitive
    expect(status).toHaveTextContent(/^Found ink/);
    expect(save).toBeEnabled();
  });

  it('recolours the ink', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { dialog } = await choosePhoto(user);
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent(/^Found ink/));

    await user.click(within(dialog).getByRole('radio', { name: 'Black' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save signature' }));
    await waitFor(() => expect(encoded).toHaveLength(1));
    const { data } = encoded[0];
    const i = data.findIndex((v, k) => k % 4 === 3 && v === 255);
    expect(Array.from(data.slice(i - 3, i))).toEqual([17, 17, 17]);
  });

  it('explains when no ink is found and blocks saving', async () => {
    photoFor = () => blankPhoto();
    const user = userEvent.setup();
    render(<App />);
    const { dialog } = await choosePhoto(user);
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('No ink found'));
    expect(within(dialog).getByRole('button', { name: 'Save signature' })).toBeDisabled();
  });

  it('reports a photo that can’t be read', async () => {
    photoFor = () => null;
    const user = userEvent.setup();
    render(<App />);
    const { dialog } = await choosePhoto(user, 'IMG_0001.HEIC');
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent('couldn’t be read. Try a JPG or PNG.')
    );
    expect(within(dialog).getByRole('button', { name: 'Save signature' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await createStampStore(globalThis.indexedDB).list()).toHaveLength(0);
  });
});
