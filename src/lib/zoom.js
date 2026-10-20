/**
 * Pure helpers for page navigation and zoom math.
 * Kept free of React/pdf.js so they can be unit-tested in isolation.
 */

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
export const ZOOM_STEP = 0.25;
export const DEFAULT_SCALE = 1;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Round to 2 decimals to avoid floating-point drift across many steps. */
export function roundScale(scale) {
  return Math.round(scale * 100) / 100;
}

/**
 * Next step up / down on the step grid. From a fitted scale off the grid
 * (say 0.53) the first step lands back on it (0.75, or 0.5), so 100% is
 * always reachable.
 */
export function zoomIn(scale, step = ZOOM_STEP) {
  const grid = Math.floor(roundScale(scale / step) + 1e-9) * step;
  return clamp(roundScale(grid + step), MIN_SCALE, MAX_SCALE);
}

export function zoomOut(scale, step = ZOOM_STEP) {
  const grid = Math.ceil(roundScale(scale / step) - 1e-9) * step;
  return clamp(roundScale(grid - step), MIN_SCALE, MAX_SCALE);
}

/**
 * Scale that fits a page `pageWidth` pt wide (as displayed, so rotation
 * applied) into `available` CSS px. Never above 100%: a page that already
 * fits opens at its real size. Rounded down so it never overflows.
 */
export function fitWidthScale(pageWidth, available) {
  if (!(pageWidth > 0) || !(available > 0)) return DEFAULT_SCALE;
  const fit = Math.floor((available / pageWidth) * 100) / 100;
  return clamp(Math.min(DEFAULT_SCALE, fit), MIN_SCALE, MAX_SCALE);
}

/** Clamp a requested page into [1, numPages]; falls back to 1 when empty. */
export function clampPage(page, numPages) {
  if (!numPages || numPages < 1) return 1;
  return clamp(Math.round(page), 1, numPages);
}

export function formatZoom(scale) {
  return `${Math.round(scale * 100)}%`;
}
