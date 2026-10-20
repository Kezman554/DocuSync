/**
 * Touch reordering for the thumbnail sidebar: the timing and geometry,
 * kept pure so it's testable without a browser. Mobile browsers don't fire
 * HTML5 drag events from touch, so the sidebar drives a long-press drag
 * with Pointer Events (ThumbnailSidebar.jsx) and asks these helpers where
 * the page would land and how fast to scroll.
 */

/** Hold this long without moving to pick a thumbnail up. */
export const LONG_PRESS_MS = 400;

/**
 * Moving further than this (px) before the long press fires means the
 * finger is scrolling the sidebar, not picking a page up.
 */
export const MOVE_TOLERANCE_PX = 8;

/** Auto-scroll starts this close (px) to the sidebar's top or bottom edge… */
export const EDGE_PX = 56;
/** …and reaches this many px per frame at the very edge. */
export const MAX_SCROLL_PX = 14;

/** Whether a press that started at `start` has moved far enough to be a scroll. */
export function movedTooFar(start, point, tolerance = MOVE_TOLERANCE_PX) {
  return Math.hypot(point.x - start.x, point.y - start.y) > tolerance;
}

/**
 * Insertion index (0..rects.length) for a finger at `y`, from the items'
 * on-screen rects in list order — the same rule as the mouse drag: the
 * upper half of a thumbnail inserts before it, the lower half after it.
 */
export function dropIndexAt(y, rects) {
  for (let i = 0; i < rects.length; i += 1) {
    if (y < rects[i].top + rects[i].height / 2) return i;
  }
  return rects.length;
}

/**
 * Scroll step (px per frame) for a finger at `y` in a scroll container with
 * on-screen bounds `rect`: negative near the top edge, positive near the
 * bottom, faster the closer it is, 0 elsewhere.
 */
export function autoScrollStep(y, rect, edge = EDGE_PX, max = MAX_SCROLL_PX) {
  const zone = Math.min(edge, rect.height / 3); // a short sidebar keeps a middle
  const fromTop = y - rect.top;
  const fromBottom = rect.top + rect.height - y;
  if (fromTop < zone) return -Math.ceil(max * Math.min(1, (zone - fromTop) / zone));
  if (fromBottom < zone) return Math.ceil(max * Math.min(1, (zone - fromBottom) / zone));
  return 0;
}

/** Whether a point is outside `rect` (moving off the sidebar cancels). */
export function isOutside({ x, y }, rect) {
  return x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height;
}
