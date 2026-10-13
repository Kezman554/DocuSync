import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake pdf.js document: records every getViewport call so we can assert what
// rotation each page was rendered with, without loading real pdf.js in jsdom.
const viewportCalls = [];
const fakePdf = {
  numPages: 3,
  getPage: vi.fn(async (pageNumber) => ({
    pageNumber,
    rotate: 0, // intrinsic /Rotate of the source page — must never change
    getViewport: ({ scale, rotation = 0 }) => {
      viewportCalls.push({ pageNumber, rotation });
      const landscape = rotation % 180 !== 0;
      return {
        width: (landscape ? 792 : 612) * scale,
        height: (landscape ? 612 : 792) * scale,
      };
    },
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  })),
  destroy: vi.fn(),
};

vi.mock('../src/lib/pdfLoader.js', () => ({
  loadPdfDocument: vi.fn(async () => fakePdf),
}));

const { default: App } = await import('../src/App.jsx');

/** Rotation most recently rendered for a source page, or undefined. */
const lastRotation = (pageNumber) =>
  viewportCalls.filter((c) => c.pageNumber === pageNumber).at(-1)?.rotation;

async function openPdf(user) {
  const { container } = render(<App />);
  const input = container.querySelector('input[type="file"]');
  await user.upload(
    input,
    new File(['%PDF-1.7'], 'sample.pdf', { type: 'application/pdf' })
  );
  await screen.findByText('Page 1 of 3');
  // Wait for the initial viewer + thumbnail renders (IO is absent → eager).
  await waitFor(() => {
    [1, 2, 3].forEach((n) => expect(lastRotation(n)).toBe(0));
  });
}

const thumb = (n) => screen.getByRole('button', { name: new RegExp(`^Page ${n}\\b`) });

describe('page rotation', () => {
  beforeEach(() => {
    viewportCalls.length = 0;
    // jsdom has no canvas implementation or scrollIntoView.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    Element.prototype.scrollIntoView ??= () => {};
  });
  afterEach(() => vi.restoreAllMocks());

  it('rotates the current page right/left and re-renders viewer and thumbnail', async () => {
    const user = userEvent.setup();
    await openPdf(user);

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
    await openPdf(user);

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
    await openPdf(user);
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    await waitFor(() => expect(lastRotation(1)).toBe(90));

    // The pdf.js source page still reports its original /Rotate.
    const page = await fakePdf.getPage(1);
    expect(page.rotate).toBe(0);
    expect(fakePdf.numPages).toBe(3);
  });
});
