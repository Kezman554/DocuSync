import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakePdf,
  lastRotation,
  openPdf,
  setupDom,
  thumb,
} from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});

const { default: App } = await import('../src/App.jsx');

describe('page rotation', () => {
  beforeEach(setupDom);
  afterEach(() => vi.restoreAllMocks());

  it('rotates the current page right/left and re-renders viewer and thumbnail', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    await waitFor(() => expect(lastRotation(1)).toBe(90));
    expect(thumb(1)).toHaveAccessibleName('Page 1, rotated 90°');
    // Viewer canvas is now landscape-shaped.
    expect(screen.getByLabelText('Page 1', { selector: 'canvas' }).style.width).toBe(
      '792px'
    );

    await user.click(screen.getByRole('button', { name: 'Rotate page left' }));
    await user.click(screen.getByRole('button', { name: 'Rotate page left' }));
    await waitFor(() => expect(lastRotation(1)).toBe(270));

    // Other pages untouched.
    expect(lastRotation(2)).toBe(0);
    expect(lastRotation(3)).toBe(0);
  });

  it('rotates every page in a multi-selection', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(thumb(2));
    await user.keyboard('{Shift>}');
    await user.click(thumb(3));
    await user.keyboard('{/Shift}');

    expect(thumb(2)).toHaveAttribute('aria-pressed', 'true');
    expect(thumb(3)).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Rotate 2 pages right' }));

    await waitFor(() => {
      expect(lastRotation(2)).toBe(90);
      expect(lastRotation(3)).toBe(90);
    });
    expect(thumb(1)).toHaveAccessibleName('Page 1');
  });

  it('does not alter the source document', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    await waitFor(() => expect(lastRotation(1)).toBe(90));

    // The pdf.js source page still reports its original /Rotate.
    const page = await fakePdf.getPage(1);
    expect(page.rotate).toBe(0);
    expect(fakePdf.numPages).toBe(4);
  });
});
