import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPdf, setupDom } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});

const { default: App } = await import('../src/App.jsx');

const strip = () => screen.queryByRole('list', { name: 'What DocuSync does' });
const LAYERS = ['.empty-well__dots', '.empty-well__light', '.empty-well__sheet'];

beforeEach(() => setupDom());
afterEach(() => vi.restoreAllMocks());

describe('empty state background and feature strip', () => {
  it('shows six information tiles and hidden decoration with no document open', () => {
    const { container } = render(<App />);

    const tiles = within(strip()).getAllByRole('listitem');
    expect(tiles.map((t) => within(t).getByRole('heading').textContent)).toEqual([
      'Pages',
      'Sign and stamp',
      'Redact',
      'Password',
      'Number and watermark',
      'Images and PDF',
    ]);
    // Information, not controls: nothing in the strip is focusable.
    expect(strip().querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);

    for (const selector of LAYERS) {
      const layers = container.querySelectorAll(selector);
      expect(layers.length).toBeGreaterThan(0);
      for (const layer of layers) expect(layer).toHaveAttribute('aria-hidden', 'true');
    }
    expect(container.querySelectorAll('.empty-well__sheet')).toHaveLength(2);
  });

  it('removes the strip and the background once a PDF is open', async () => {
    const { container } = await openPdf(App, userEvent.setup());

    expect(strip()).toBeNull();
    for (const selector of LAYERS) {
      expect(container.querySelector(selector)).toBeNull();
    }
  });
});
