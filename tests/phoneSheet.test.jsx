import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';
import { PHONE_QUERY } from '../src/hooks/useMediaQuery.js';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { default: App } = await import('../src/App.jsx');

/** Pretend to be a phone: the phone media query matches. */
function asPhone() {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query === PHONE_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function pointer(type, el, x, y) {
  const event = createEvent[type](el, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    pointerId: { value: 1 },
    button: { value: 0 },
  });
  fireEvent(el, event);
}

const sheet = () => screen.getByRole('complementary', { name: 'Inspector' });
const summary = () => sheet().querySelector('.inspector__summary');
const handle = () => within(sheet()).getByRole('button', { name: /the inspector$/ });
const body = () => sheet().querySelector('.inspector__sheet-body');

/** Make the viewer's scroll area `px` wide (jsdom lays nothing out). */
function viewerWidth(px) {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth() {
    return this.classList.contains('viewer__scroll') ? px : width.get.call(this);
  });
}

describe('phone bottom sheet', () => {
  beforeEach(() => {
    setupDom();
    asPhone();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts lowered: handle, summary, page navigation and zoom; the sections hidden', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    expect(sheet()).not.toHaveClass('inspector--raised');
    expect(handle()).toHaveAccessibleName('Raise the inspector');
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    expect(summary()).toHaveTextContent('Page 1 · rotate, extract, delete');
    for (const name of ['Previous page', 'Next page', 'Zoom out', 'Zoom in']) {
      expect(within(sheet()).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(body()).not.toBeVisible();
    expect(within(sheet()).queryByRole('heading', { name: 'Document' })).toBeNull();
    // Navigation moved off the tool row on a phone.
    const row = screen.getByRole('toolbar', { name: 'Tools' });
    expect(within(row).queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('raises and lowers by tapping the summary', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(summary());
    expect(sheet()).toHaveClass('inspector--raised');
    expect(summary()).toHaveAttribute('aria-expanded', 'true');
    expect(body()).toBeVisible();
    expect(within(body()).getByRole('heading', { name: 'Document' })).toBeInTheDocument();
    expect(within(body()).getByRole('button', { name: 'Delete page' })).toBeInTheDocument();
    await user.click(summary());
    expect(sheet()).not.toHaveClass('inspector--raised');
  });

  it('raises when the handle is dragged up, lowers when dragged down, toggles on a tap', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    pointer('pointerDown', handle(), 100, 700);
    pointer('pointerUp', handle(), 100, 600);
    fireEvent.click(handle()); // the click that follows a drag is ignored
    expect(sheet()).toHaveClass('inspector--raised');
    expect(handle()).toHaveAccessibleName('Lower the inspector');

    pointer('pointerDown', handle(), 100, 300);
    pointer('pointerUp', handle(), 100, 420);
    fireEvent.click(handle());
    expect(sheet()).not.toHaveClass('inspector--raised');

    await user.click(handle()); // a tap (or Enter/Space) toggles
    expect(sheet()).toHaveClass('inspector--raised');
  });

  it('the summary follows the top section as the selection changes', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.keyboard('{Control>}');
    await user.click(thumb(3));
    await user.keyboard('{/Control}');
    expect(summary()).toHaveTextContent('2 pages selected · rotate, extract, delete');

    await user.click(thumb(1));
    await user.click(screen.getByRole('button', { name: 'Add text' }));
    expect(summary()).toHaveTextContent(/^New text · Helvetica \d+$/);

    const layer = await screen.findByRole('group', { name: 'Annotations on page 1' });
    pointer('pointerDown', layer, 100, 150);
    pointer('pointerUp', layer, 100, 150);
    await user.type(screen.getByRole('textbox', { name: 'Text' }), 'łódka');
    await waitFor(() =>
      expect(summary()).toHaveTextContent(/^Text box · Helvetica \d+ · 1 character won’t export$/)
    );
  });

  it('shows the stamps library at the top of the sheet, raised, with the page sections below', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Stamps' }));
    expect(sheet()).toHaveClass('inspector--raised');
    expect(summary()).toHaveTextContent('Stamps · pick one, then tap the page');
    const headings = within(body())
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Stamps', 'Page 1', 'Document']);
  });

  it('puts the mode switch in File ▾ and keeps “Export PDF” as the button’s name', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    expect(screen.queryByRole('button', { name: /Switch to (dark|light) mode/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export PDF' })).toHaveTextContent(/^Export$/);
    expect(screen.getByRole('img', { name: 'On this device · nothing uploaded' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: /^(Dark|Light) mode$/ })).toBeInTheDocument();
  });
});

describe('fit to width on open', () => {
  beforeEach(() => setupDom());
  afterEach(() => vi.restoreAllMocks());

  it('at 1024 × 768 with the inspector open, a Letter page opens fitted, its left edge in view', async () => {
    // 1024 px: 200 px thumbnails and the 290 px inspector leave the viewer
    // 534 px, less its 24 px gutters — narrower than Letter at 100% (612 px).
    viewerWidth(534);
    const user = userEvent.setup();
    await openPdf(App, user);
    await waitFor(() => expect(screen.getByText('79%')).toBeInTheDocument());
    const canvas = screen.getByLabelText('Page 1', { selector: 'canvas' });
    // The whole page width fits inside the gutters, so its left edge shows.
    expect(parseFloat(canvas.style.width)).toBeLessThanOrEqual(534 - 48);

    // Zoom still goes back to 100%.
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('a page that already fits opens at 100%', async () => {
    viewerWidth(900);
    const user = userEvent.setup();
    await openPdf(App, user);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
