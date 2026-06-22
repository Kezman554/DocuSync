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

export function zoomIn(scale, step = ZOOM_STEP) {
  return clamp(roundScale(scale + step), MIN_SCALE, MAX_SCALE);
}

export function zoomOut(scale, step = ZOOM_STEP) {
  return clamp(roundScale(scale - step), MIN_SCALE, MAX_SCALE);
}

/** Clamp a requested page into [1, numPages]; falls back to 1 when empty. */
export function clampPage(page, numPages) {
  if (!numPages || numPages < 1) return 1;
  return clamp(Math.round(page), 1, numPages);
}

export function formatZoom(scale) {
  return `${Math.round(scale * 100)}%`;
}
