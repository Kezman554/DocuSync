import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});
vi.mock('../src/lib/download.js', () => ({ downloadBytes: vi.fn() }));

const { default: App } = await import('../src/App.jsx');

/** Dispatch a pointer event with coordinates (jsdom has no PointerEvent). */
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
const layer = () => screen.findByRole('group', { name: 'Annotations on page 1' });
const inspector = () => screen.getByRole('complementary', { name: 'Inspector' });
const headings = () =>
  within(inspector())
    .queryAllByRole('heading')
    .map((h) => h.textContent);
const menu = (name) => screen.queryByRole('menu', { name });

beforeEach(() => setupDom());
afterEach(() => vi.restoreAllMocks());

describe('header menus', () => {
  it('File ▾ opens from the keyboard, moves with the arrows and closes on Esc', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const trigger = screen.getByRole('button', { name: 'File' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = within(menu('File')).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Open another',
      'Add PDF…',
      'From images…',
      'Close',
    ]);
    expect(items[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}'); // wraps from the first to the last
    expect(items[3]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items[3]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(menu('File')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('Export ▾ opens on its last item with ↑, and choosing returns focus to the trigger', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const trigger = screen.getByRole('button', { name: 'More export options' });
    trigger.focus();
    await user.keyboard('{ArrowUp}');
    const items = within(menu('More export options')).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Export with password…',
      'Extract pages…',
      'Export images…',
      'Compress…',
    ]);
    expect(items[3]).toHaveFocus();

    await user.keyboard('{ArrowUp}{ArrowUp}{Enter}'); // Extract pages…
    expect(menu('More export options')).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Extract pages' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('↓ on the trigger opens on the first item; Esc returns focus there', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const trigger = screen.getByRole('button', { name: 'More export options' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu('More export options')).getByRole('menuitem', { name: 'Export with password…' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(menu('More export options')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on Tab or a click outside', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(menu('File')).not.toBeNull();
    await user.tab();
    expect(menu('File')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(menu('File')).not.toBeNull();
    await user.click(screen.getByText('DocuSync'));
    expect(menu('File')).toBeNull();
  });

  it('Esc in a menu leaves the active tool alone', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Place marker' }));
    screen.getByRole('button', { name: 'File' }).focus();
    await user.keyboard('{Enter}{Escape}');
    expect(menu('File')).toBeNull();
    expect(screen.getByRole('button', { name: 'Place marker' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('with no document: File ▾ offers Open PDF… and From images…, and there is no Export', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(within(menu('File')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Open PDF…',
      'From images…',
    ]);
    expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More export options' })).toBeNull();
    expect(screen.getByText('On this device · nothing uploaded')).toBeInTheDocument();
  });
});

describe('tool row', () => {
  it('holds the tools, page navigation and zoom; nothing floats over the page', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const row = screen.getByRole('toolbar', { name: 'Tools' });
    for (const name of ['Place marker', 'Add text', 'Add image', 'Redact', 'Stamps', 'Previous page', 'Next page', 'Zoom out', 'Zoom in']) {
      expect(within(row).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(document.querySelector('.page-controls')).toBeNull(); // the old floating panel
  });

  it('with no document only Stamps works', () => {
    render(<App />);
    const row = screen.getByRole('toolbar', { name: 'Tools' });
    for (const name of ['Place marker', 'Add text', 'Add image', 'Redact']) {
      expect(within(row).getByRole('button', { name })).toBeDisabled();
    }
    expect(within(row).getByRole('button', { name: 'Stamps' })).toBeEnabled();
  });
});

describe('inspector', () => {
  it('shows only the sections that apply, in order, as the selection changes', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    expect(headings()).toEqual(['Page 1', 'Document']);

    // Two pages selected: the pages section follows, with its actions.
    await user.keyboard('{Control>}');
    await user.click(thumb(3));
    await user.keyboard('{/Control}');
    expect(headings()).toEqual(['2 pages selected', 'Document']);
    expect(within(inspector()).getByRole('button', { name: 'Delete 2 pages' })).toBeEnabled();
    expect(within(inspector()).getByRole('button', { name: 'Rotate 2 pages right' })).toBeInTheDocument();

    // Back to one page.
    await user.click(thumb(2));
    expect(headings()).toEqual(['Page 2', 'Document']);

    // The Text tool: format controls for the next box, first.
    await user.click(screen.getByRole('button', { name: 'Add text' }));
    expect(headings()).toEqual(['New text', 'Page 2', 'Document']);
    expect(within(inspector()).getByRole('group', { name: 'Text formatting' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add text' }));
    expect(headings()).toEqual(['Page 2', 'Document']);
  });

  it('shows a selected annotation first, and drops it when it goes', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Place marker' }));
    const el = await layer();
    pointer('pointerDown', el, 200, 300);
    pointer('pointerUp', el, 200, 300);
    expect(headings()).toEqual(['Marker', 'Page 1', 'Document']);

    await user.click(screen.getByRole('button', { name: /^Delete marker/ }));
    expect(headings()).toEqual(['Page 1', 'Document']);
  });

  it('a selected text box gets its format controls and the missing-character warning', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Add text' }));
    const el = await layer();
    pointer('pointerDown', el, 100, 150);
    pointer('pointerUp', el, 100, 150);
    await user.keyboard('Hi');
    expect(headings()[0]).toBe('Text box');
    const group = within(inspector()).getByRole('group', { name: 'Text formatting' });
    expect(within(group).getByLabelText('Font')).toBeInTheDocument();
    expect(within(group).getByRole('status')).toBeInTheDocument(); // the warning's live region
  });

  it('Extract… opens the extract dialog with the selected pages', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.keyboard('{Control>}');
    await user.click(thumb(3));
    await user.keyboard('{/Control}');
    await user.click(within(inspector()).getByRole('button', { name: 'Extract…' }));
    const dialog = screen.getByRole('dialog', { name: 'Extract pages' });
    expect(within(dialog).getByLabelText(/^Pages/)).toHaveValue('1, 3');
  });

  it('Document: Page numbers and Watermark show Off/On, Password opens the password export', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const doc = within(inspector());
    expect(doc.getByRole('button', { name: /^Page numbers…/ })).toHaveTextContent('Off');
    expect(doc.getByRole('button', { name: /^Watermark…/ })).toHaveTextContent('Off');
    // They left the thumbnail sidebar.
    const sidebar = screen.getByRole('complementary', { name: 'Page thumbnails' });
    expect(within(sidebar).queryByRole('button', { name: /Page numbers|Watermark/ })).toBeNull();

    await user.click(doc.getByRole('button', { name: 'Password…' }));
    expect(screen.getByRole('dialog', { name: 'Export with password' })).toBeInTheDocument();
  });

  it('keeps the page sections reachable while the stamps panel is open', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Stamps' }));
    const panel = within(inspector()).getByRole('region', { name: 'Stamps' });
    expect(panel).toBeInTheDocument();
    expect(headings()).toEqual(expect.arrayContaining(['Page 1', 'Document']));
  });
});
