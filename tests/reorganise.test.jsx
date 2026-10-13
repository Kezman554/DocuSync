import {
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

const { default: App } = await import('../src/App.jsx');

const dataTransfer = () => ({
  setData: vi.fn(),
  effectAllowed: '',
  dropEffect: '',
});

/**
 * Drag the thumbnail at position `from` onto the thumbnail at position `onto`.
 * jsdom lays nothing out (every rect is 0×0 at the origin), so clientY 0 lands
 * in the "before" half and clientY 1 in the "after" half. jsdom has no
 * DragEvent, so clientY is set on the event by hand.
 */
function drag(from, onto, where = 'before') {
  const dt = dataTransfer();
  const target = thumb(onto).closest('li');
  fireEvent.dragStart(thumb(from), { dataTransfer: dt });
  const over = createEvent.dragOver(target, { dataTransfer: dt });
  Object.defineProperty(over, 'clientY', { value: where === 'after' ? 1 : 0 });
  fireEvent(target, over);
  fireEvent.drop(target, { dataTransfer: dt });
  fireEvent.dragEnd(thumb(1), { dataTransfer: dt });
}

/** Labels 1..n in order, matching the model length. */
const expectSequentialLabels = (n) => {
  const labels = Array.from(document.querySelectorAll('.sidebar__thumb-label')).map(
    (el) => el.textContent
  );
  expect(labels).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
};

describe('page reordering', () => {
  beforeEach(setupDom);
  afterEach(() => vi.restoreAllMocks());

  it('drags a page to a new position and keeps the viewer on it', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    drag(1, 3, 'after');

    expect(sidebarOrder()).toEqual([2, 3, 1, 4]);
    expectSequentialLabels(4);
    // Source page 1 was current; it's now at position 3 and still shown.
    expect(screen.getByText('Page 3 of 4')).toBeInTheDocument();
    expect(thumb(3)).toHaveAttribute('aria-current', 'page');
  });

  it('drags a multi-selection as a block', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(thumb(3));
    await user.keyboard('{Shift>}');
    await user.click(thumb(4));
    await user.keyboard('{/Shift}');

    drag(4, 1, 'before');
    expect(sidebarOrder()).toEqual([3, 4, 1, 2]);
    expectSequentialLabels(4);
  });

  it('ignores a drop onto the page’s own position', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    drag(2, 2, 'after');
    expect(sidebarOrder()).toEqual([1, 2, 3, 4]);
  });

  it('moves pages with Alt+Arrow keys', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(thumb(2));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(sidebarOrder()).toEqual([1, 3, 2, 4]);
    await user.keyboard('{Alt>}{ArrowUp}{ArrowUp}{/Alt}');
    expect(sidebarOrder()).toEqual([2, 1, 3, 4]);
    // Already at the top: no-op.
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(sidebarOrder()).toEqual([2, 1, 3, 4]);
  });

  it('keeps per-page rotation when a page moves', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    await waitFor(() => expect(lastRotation(1)).toBe(90));
    drag(1, 4, 'after');

    expect(sidebarOrder()).toEqual([2, 3, 4, 1]);
    expect(thumb(4)).toHaveAccessibleName('Page 4, rotated 90°');
    expect(thumb(1)).toHaveAccessibleName('Page 1');
  });
});

describe('page deletion', () => {
  beforeEach(setupDom);
  afterEach(() => vi.restoreAllMocks());

  it('asks for confirmation and does nothing on cancel', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(thumb(2));
    await user.click(screen.getByRole('button', { name: 'Delete page' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete page 2?' });
    // Safe default: Cancel has focus.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(sidebarOrder()).toEqual([1, 2, 3, 4]);
  });

  it('Escape cancels the dialog', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Delete page' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(sidebarOrder()).toEqual([1, 2, 3, 4]);
  });

  it('deletes the page on confirm and lands on the next page', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(thumb(2));
    await user.click(screen.getByRole('button', { name: 'Delete page' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete page',
      })
    );

    expect(sidebarOrder()).toEqual([1, 3, 4]);
    expectSequentialLabels(3);
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(thumb(2)).toHaveAttribute('aria-current', 'page');
    expect(thumb(2)).toHaveAttribute('aria-pressed', 'true');
    // Source document untouched.
    expect(fakePdf.numPages).toBe(4);
  });

  it('deletes a multi-selection via the Delete key', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(thumb(1));
    await user.keyboard('{Control>}');
    await user.click(thumb(3));
    await user.keyboard('{/Control}');
    await user.keyboard('{Delete}');

    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete 2 pages (1, 3)?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 pages' }));

    expect(sidebarOrder()).toEqual([2, 4]);
    expectSequentialLabels(2);
  });

  it('deleting the last page lands on the new last page', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(thumb(4));
    await user.keyboard('{Delete}');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete page',
      })
    );

    expect(sidebarOrder()).toEqual([1, 2, 3]);
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
  });

  it('will not delete every page', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    await user.click(thumb(1));
    await user.keyboard('{Shift>}');
    await user.click(thumb(4));
    await user.keyboard('{/Shift}');

    expect(screen.getByRole('button', { name: 'Delete 4 pages' })).toBeDisabled();
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
