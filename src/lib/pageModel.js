/**
 * In-memory document model: an ordered list of page entries.
 *
 * Each entry points at a page in the source PDF and carries the user's
 * non-destructive edits (currently rotation). The source document is never
 * modified — edits are only baked in on export.
 *
 *   { id: string, sourcePage: number (1-based), rotation: 0 | 90 | 180 | 270 }
 *
 * All functions are pure and return new arrays/sets rather than mutating.
 */

/** Build the initial model: one entry per source page, in source order. */
export function createPageModel(numPages) {
  return Array.from({ length: Math.max(0, numPages | 0) }, (_, i) => ({
    id: `p${i + 1}`,
    sourcePage: i + 1,
    rotation: 0,
  }));
}

/** Normalise any multiple of 90 into [0, 360). */
export function normalizeRotation(degrees) {
  const quarterTurns = Math.round(degrees / 90);
  return (((quarterTurns % 4) + 4) % 4) * 90;
}

/**
 * Rotate the pages whose ids are in `ids` by `delta` degrees
 * (+90 = clockwise / right, -90 = anticlockwise / left).
 */
export function rotatePages(pages, ids, delta) {
  const targets = ids instanceof Set ? ids : new Set(ids);
  if (targets.size === 0 || delta % 360 === 0) return pages;
  return pages.map((page) =>
    targets.has(page.id)
      ? { ...page, rotation: normalizeRotation(page.rotation + delta) }
      : page
  );
}

/**
 * Rotation to hand to pdf.js: the page's intrinsic /Rotate plus our edit.
 * (pdf.js `getViewport({ rotation })` replaces the intrinsic value rather
 * than adding to it, so we combine them here.)
 */
export function effectiveRotation(intrinsicRotate, rotation) {
  return normalizeRotation((intrinsicRotate || 0) + rotation);
}

/**
 * Compute the next selection after the user clicks page `id`.
 *
 * - plain click: select only that page
 * - toggle (Ctrl/Cmd): add/remove that page, keeping the rest
 * - range (Shift): select every page between `anchorId` and `id`
 *
 * Returns { selected: Set<string>, anchorId: string }.
 */
export function nextSelection(
  pages,
  selected,
  anchorId,
  id,
  { toggle = false, range = false } = {}
) {
  if (range && anchorId) {
    const from = pages.findIndex((p) => p.id === anchorId);
    const to = pages.findIndex((p) => p.id === id);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      return {
        selected: new Set(pages.slice(lo, hi + 1).map((p) => p.id)),
        anchorId,
      };
    }
  }

  if (toggle) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selected: next, anchorId: id };
  }

  return { selected: new Set([id]), anchorId: id };
}
