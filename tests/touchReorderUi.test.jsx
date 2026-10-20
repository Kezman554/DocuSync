import { act, createEvent, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPdf, setupDom, thumb } from './helpers/fakePdf.jsx';

vi.mock('../src/lib/pdfLoader.js', async () => {
  const { pdfFor } = await import('./helpers/fakePdf.jsx');
  return { loadPdfDocument: vi.fn(async (file) => pdfFor(file)) };
});

const { default: App } = await import('../src/App.jsx');

// jsdom lays nothing out, so give the sidebar a geometry: a 200 × 500 px
// sidebar at the top-left, thumbnails 190 px tall every 200 px (4 pages =
// 800 px of list), moved up by the scroll position.
const ITEM = 200;
const VIEW = 500;
function layout() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const box = (top, height, width = 200) => ({
      top, height, left: 0, width, bottom: top + height, right: width, x: 0, y: top,
    });
    if (this.classList.contains('sidebar__item')) {
      const index = Array.prototype.indexOf.call(this.parentElement.children, this);
      return box(index * ITEM - this.closest('.sidebar__scroll').scrollTop, ITEM - 10);
    }
    if (this.classList.contains('sidebar__scroll') || this.classList.contains('sidebar')) {
      return box(0, VIEW);
    }
    return box(0, 0, 0);
  });
}

/** A pointer event with the fields the sidebar reads (jsdom has no PointerEvent). */
function pointer(type, el, { x = 100, y, pointerType = 'touch', pointerId = 7 }) {
  const event = createEvent[type](el, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    button: { value: 0 },
  });
  fireEvent(el, event);
  return event;
}

const items = () => Array.from(document.querySelectorAll('.sidebar__item'));
const scroller = () => document.querySelector('.sidebar__scroll');
/** Source page numbers in sidebar order — the page model as shown. */
const order = () =>
  Array.from(document.querySelectorAll('.sidebar__thumb')).map((t) =>
    Number(t.getAttribute('data-source-page'))
  );
const selectedPages = () =>
  Array.from(document.querySelectorAll('.sidebar__thumb'))
    .filter((t) => t.getAttribute('aria-pressed') === 'true')
    .map((t) => Number(t.getAttribute('data-source-page')));
const wait = (ms) => act(() => vi.advanceTimersByTime(ms));

/** Touch and hold item `index` (at its centre) until it lifts. */
async function pickUp(index) {
  const y = index * ITEM + 95 - scroller().scrollTop;
  pointer('pointerDown', items()[index], { y });
  await wait(400);
  return items()[index]; // touch pointers stay with this element (implicit capture)
}

describe('touch reordering in the sidebar', () => {
  let user;
  const ctrlClick = async (el) => {
    await user.keyboard('{Control>}');
    await user.click(el);
    await user.keyboard('{/Control}');
  };
  beforeEach(async () => {
    setupDom();
    navigator.vibrate = vi.fn();
    user = userEvent.setup();
    await openPdf(App, user);
    layout();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete navigator.vibrate;
  });

  const fakeTimers = () =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });

  it('a long press lifts the page; dragging shows the indicator; release moves it', async () => {
    fakeTimers();
    const el = items()[0];
    pointer('pointerDown', el, { y: 95 });
    await wait(399);
    expect(document.querySelector('.sidebar__thumb--lifted')).toBeNull();
    await wait(1);
    // Lifted, with a buzz where the device can.
    expect(thumb(1)).toHaveClass('sidebar__thumb--lifted');
    expect(navigator.vibrate).toHaveBeenCalledWith(30);

    // Over the lower half of page 2: the same indicator as the mouse drag.
    pointer('pointerMove', el, { y: 350 });
    expect(items()[2]).toHaveClass('sidebar__item--drop-before');

    pointer('pointerUp', el, { y: 350 });
    expect(order()).toEqual([2, 1, 3, 4]);
    expect(document.querySelector('.sidebar__thumb--lifted')).toBeNull();
    expect(document.querySelector('.sidebar__item--drop-before')).toBeNull();
  });

  it('a short press that moves is a scroll: nothing lifts or moves', async () => {
    fakeTimers();
    const el = items()[0];
    pointer('pointerDown', el, { y: 95 });
    await wait(150);
    pointer('pointerMove', el, { y: 140 }); // swiping before the long press
    await wait(600);
    pointer('pointerMove', el, { y: 350 });
    pointer('pointerUp', el, { y: 350 });
    expect(document.querySelector('.sidebar__thumb--lifted')).toBeNull();
    expect(document.querySelector('.sidebar__item--drop-before')).toBeNull();
    expect(order()).toEqual([1, 2, 3, 4]);
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it('only a lifted page stops the sidebar scrolling', async () => {
    fakeTimers();
    const touchMove = () => fireEvent(scroller(), createEvent.touchMove(scroller(), { cancelable: true }));
    pointer('pointerDown', items()[0], { y: 95 });
    expect(touchMove()).toBe(true); // not yet lifted: the browser may scroll
    await wait(400);
    expect(touchMove()).toBe(false); // lifted: scrolling is blocked
  });

  it('dragging a selected page moves the whole selection, without reselecting on release', async () => {
    await ctrlClick(thumb(2)); // pages 1 and 2 selected
    expect(selectedPages()).toEqual([1, 2]);
    fakeTimers();

    const el = await pickUp(1);
    pointer('pointerMove', el, { y: 497 }); // over the lower half of page 3
    pointer('pointerUp', el, { y: 497 });
    // The click that follows a touch release mustn't collapse the selection.
    fireEvent.click(el.querySelector('.sidebar__thumb'));

    expect(order()).toEqual([3, 1, 2, 4]);
    expect(selectedPages()).toEqual([1, 2]);
  });

  it('dragging an unselected page moves only that page', async () => {
    await ctrlClick(thumb(2)); // pages 1 and 2 selected
    expect(selectedPages()).toEqual([1, 2]);
    fakeTimers();

    const el = await pickUp(2); // page 3, not selected
    pointer('pointerMove', el, { y: 20 }); // above page 1's middle
    pointer('pointerUp', el, { y: 20 });

    expect(order()).toEqual([3, 1, 2, 4]);
    expect(selectedPages()).toEqual([3]); // as with the mouse: it becomes the selection
  });

  it('pointercancel cancels the drag and changes nothing', async () => {
    fakeTimers();
    const el = await pickUp(0);
    pointer('pointerMove', el, { y: 350 });
    expect(items()[2]).toHaveClass('sidebar__item--drop-before');
    pointer('pointerCancel', el, { y: 350 });
    expect(document.querySelector('.sidebar__item--drop-before')).toBeNull();
    expect(document.querySelector('.sidebar__thumb--lifted')).toBeNull();
    pointer('pointerUp', el, { y: 350 });
    expect(order()).toEqual([1, 2, 3, 4]);
  });

  it('moving off the sidebar cancels the drag and changes nothing', async () => {
    fakeTimers();
    const el = await pickUp(0);
    pointer('pointerMove', el, { y: 350 });
    pointer('pointerMove', el, { x: 260, y: 350 }); // off to the right, over the page
    expect(document.querySelector('.sidebar__thumb--lifted')).toBeNull();
    pointer('pointerMove', el, { x: 100, y: 350 });
    pointer('pointerUp', el, { x: 100, y: 350 });
    expect(order()).toEqual([1, 2, 3, 4]);
  });

  it('auto-scrolls near the bottom edge so a page can travel the whole list', async () => {
    fakeTimers();
    const el = await pickUp(0);
    // Without scrolling, y = 490 is over page 3's upper half (index 2).
    pointer('pointerMove', el, { y: 490 });
    expect(items()[2]).toHaveClass('sidebar__item--drop-before');
    await wait(500); // ~30 frames in the bottom edge zone
    expect(scroller().scrollTop).toBeGreaterThan(300);
    pointer('pointerUp', el, { y: 490 });
    expect(order()).toEqual([2, 3, 4, 1]); // carried to the end
  });

  it('auto-scrolls up near the top edge', async () => {
    scroller().scrollTop = 300; // page 4 near the top of the view
    fakeTimers();
    const el = items()[3];
    pointer('pointerDown', el, { y: 3 * ITEM + 95 - 300 });
    await wait(400);
    pointer('pointerMove', el, { y: 5 });
    await wait(500);
    expect(scroller().scrollTop).toBeLessThan(300);
  });

  it('leaves mouse and pen to the HTML5 drag', async () => {
    fakeTimers();
    for (const pointerType of ['mouse', 'pen']) {
      pointer('pointerDown', items()[0], { y: 95, pointerType });
      await wait(600);
      expect(document.querySelector('.sidebar__thumb--lifted')).toBeNull();
      pointer('pointerUp', items()[0], { y: 95, pointerType });
    }
    expect(order()).toEqual([1, 2, 3, 4]);
  });

  it('keeps the browser’s long-press menu away while pressing', async () => {
    fakeTimers();
    pointer('pointerDown', items()[0], { y: 95 });
    expect(fireEvent.contextMenu(items()[0])).toBe(false);
    pointer('pointerUp', items()[0], { y: 95 });
    expect(fireEvent.contextMenu(items()[0])).toBe(true);
  });
});
