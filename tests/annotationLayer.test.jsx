import { createEvent, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});

const { default: App } = await import('../src/App.jsx');

// Pages are US Letter (612 × 792 pt). jsdom lays nothing out, so the layer's
// bounding rect sits at (0, 0) and clientX/Y are layer-local pixels.

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

const layer = (page = 1) => screen.findByRole('group', { name: `Annotations on page ${page}` });

const box = (el) => ({
  left: parseFloat(el.style.left),
  top: parseFloat(el.style.top),
  width: parseFloat(el.style.width),
  height: parseFloat(el.style.height),
});

const expectBox = (el, expected) => {
  const actual = box(el);
  for (const k of Object.keys(expected)) expect(actual[k]).toBeCloseTo(expected[k], 6);
};

/** Turn on the marker tool and click at (x, y) on the page. */
async function placeMarker(user, x, y) {
  await user.click(screen.getByRole('button', { name: 'Place marker' }));
  const el = await layer();
  pointer('pointerDown', el, x, y);
  pointer('pointerUp', el, x, y);
  return screen.getByRole('button', { name: 'Marker 1' });
}

describe('annotation layer', () => {
  beforeEach(setupDom);
  afterEach(() => vi.restoreAllMocks());

  it('places a test marker that stays anchored across zoom levels', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);

    // Click places a default 120 × 48 pt marker centred on the pointer.
    const marker = await placeMarker(user, 200, 300);
    expectBox(marker, { left: 140, top: 276, width: 120, height: 48 });
    expect(marker).toHaveAttribute('aria-pressed', 'true');
    expect(marker).toHaveFocus();
    // One-shot tool: back to select mode.
    expect(screen.getByRole('button', { name: 'Place marker' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    // 125%, 150%: everything scales from the page's top-left — same PDF spot.
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 175,
      top: 345,
      width: 150,
      height: 60,
    });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 210,
      top: 414,
      width: 180,
      height: 72,
    });

    // Down to 50% and back to 100%: returns exactly to where it was placed.
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    }
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 70,
      top: 138,
      width: 60,
      height: 24,
    });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 140,
      top: 276,
      width: 120,
      height: 48,
    });

    // The layer always matches the rendered page size.
    expect(box(await layer())).toMatchObject({ width: 612, height: 792 });
  });

  it('keeps markers on their own page across page changes', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await placeMarker(user, 200, 300);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    const page2 = await layer(2);
    expect(within(page2).queryByRole('button', { name: /^Marker/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    await layer(1);
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 140,
      top: 276,
      width: 120,
      height: 48,
    });
  });

  it('follows the page when it is rotated and reordered', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await placeMarker(user, 200, 300); // PDF x 140–260, y 468–516

    // 90° clockwise: x' = PDF y, y' = PDF x — and it's now sideways.
    await user.click(screen.getByRole('button', { name: 'Rotate page right' }));
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 468,
      top: 140,
      width: 48,
      height: 120,
    });
    expect(box(await layer())).toMatchObject({ width: 792, height: 612 });

    // Move page 1 to the end: the marker goes with it.
    await user.click(thumb(1));
    await user.keyboard('{Alt>}{ArrowDown}{ArrowDown}{ArrowDown}{/Alt}');
    expect(screen.getByText('Page 4 of 4')).toBeInTheDocument();
    expect(await layer(4)).toContainElement(screen.getByRole('button', { name: 'Marker 1' }));
  });

  it('moves by dragging and with the arrow keys, staying on the page', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    const marker = await placeMarker(user, 200, 300);
    const el = await layer();

    pointer('pointerDown', marker, 200, 300);
    pointer('pointerMove', el, 250, 320);
    pointer('pointerUp', el, 250, 320);
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), { left: 190, top: 296 });

    // Drag far off the page: clamped to the edge.
    pointer('pointerDown', screen.getByRole('button', { name: 'Marker 1' }), 250, 320);
    pointer('pointerMove', el, -400, -400);
    pointer('pointerUp', el, -400, -400);
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), { left: 0, top: 0 });

    // Keyboard: 1pt per press, 10pt with Shift — at 150% that's 1.5px / 15px.
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    screen.getByRole('button', { name: 'Marker 1' }).focus();
    await user.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}');
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), { left: 1.5, top: 15 });
  });

  it('resizes from a corner handle', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await placeMarker(user, 200, 300); // 140,276 120×48
    const el = await layer();

    const se = document.querySelector('[data-handle="se"]');
    pointer('pointerDown', se, 260, 324);
    pointer('pointerMove', el, 290, 344);
    pointer('pointerUp', el, 290, 344);
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 140,
      top: 276,
      width: 150,
      height: 68,
    });

    // The new size is stored in points: at 200% it's twice as big on screen.
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 280,
      top: 552,
      width: 300,
      height: 136,
    });
  });

  it('draws a marker by dragging with the marker tool', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Place marker' }));
    const el = await layer();

    pointer('pointerDown', el, 150, 110);
    pointer('pointerMove', el, 50, 50);
    pointer('pointerUp', el, 50, 50);
    expectBox(screen.getByRole('button', { name: 'Marker 1' }), {
      left: 50,
      top: 50,
      width: 100,
      height: 60,
    });
  });

  it('selects, deselects and deletes markers', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await placeMarker(user, 200, 300);
    await placeMarker(user, 400, 600);
    const el = await layer();
    expect(screen.getAllByRole('button', { name: /^Marker/ })).toHaveLength(2);

    // Clicking empty page deselects.
    pointer('pointerDown', el, 20, 20);
    pointer('pointerUp', el, 20, 20);
    for (const m of screen.getAllByRole('button', { name: /^Marker/ })) {
      expect(m).toHaveAttribute('aria-pressed', 'false');
    }

    // Delete key on a focused marker.
    screen.getByRole('button', { name: 'Marker 1' }).focus();
    await user.keyboard('{Delete}');
    expect(screen.getAllByRole('button', { name: /^Marker/ })).toHaveLength(1);

    // Delete button on the selected marker.
    pointer('pointerDown', screen.getByRole('button', { name: 'Marker 1' }), 400, 600);
    pointer('pointerUp', el, 400, 600);
    await user.click(screen.getByRole('button', { name: 'Delete marker 1' }));
    expect(screen.queryByRole('button', { name: /^Marker/ })).toBeNull();
  });

  it('Escape cancels the marker tool without placing anything', async () => {
    const user = userEvent.setup();
    await openPdf(App, user);
    await user.click(screen.getByRole('button', { name: 'Place marker' }));
    (await layer()).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Place marker' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.queryByRole('button', { name: /^Marker/ })).toBeNull();
  });
});
