/**
 * Parse and format page-range strings like "1-3, 5, 8-".
 *
 * Page numbers are 1-based positions in the current (edited) document, as
 * shown in the sidebar. Pure functions so they can be unit-tested.
 */

const DASH = /\s*[-–—]\s*/; // hyphen, en dash, em dash

/**
 * Parse `input` against a document of `numPages` pages.
 *
 * Accepts comma-separated items: "5" (single), "2-4" (range, either order),
 * "7-" (to the end) and "-3" (from the start). Duplicates are merged and the
 * result is sorted into document order.
 *
 * @returns {{ pages: number[] } | { error: string }}
 */
export function parsePageRanges(input, numPages) {
  const text = (input ?? '').trim();
  if (!text) return { error: 'Enter pages to extract, e.g. 1-3, 5' };

  const pages = new Set();
  for (const raw of text.split(',')) {
    const item = raw.trim();
    if (!item) continue;

    const parts = item.split(DASH);
    let from;
    let to;
    if (parts.length === 1) {
      from = to = toPage(parts[0]);
    } else if (parts.length === 2) {
      from = parts[0] === '' ? 1 : toPage(parts[0]);
      to = parts[1] === '' ? numPages : toPage(parts[1]);
      if (parts[0] === '' && parts[1] === '') from = to = null;
    }
    if (from == null || to == null) {
      return { error: `“${item}” isn’t a page number or range` };
    }

    const [lo, hi] = from <= to ? [from, to] : [to, from];
    if (lo < 1 || hi > numPages) {
      const bad = lo < 1 ? lo : hi;
      return {
        error: `There’s no page ${bad} — this document has ${numPages} ${
          numPages === 1 ? 'page' : 'pages'
        }`,
      };
    }
    for (let p = lo; p <= hi; p += 1) pages.add(p);
  }

  if (pages.size === 0) return { error: 'Enter pages to extract, e.g. 1-3, 5' };
  return { pages: [...pages].sort((a, b) => a - b) };
}

/** "12" → 12; anything that isn't a plain positive integer → null. */
function toPage(token) {
  return /^\d+$/.test(token) ? Number(token) : null;
}

/** [1, 2, 3, 5, 7, 8] → "1-3, 5, 7-8". Input may be unsorted / duplicated. */
export function formatPageRanges(positions) {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i];
    while (sorted[i + 1] === sorted[i] + 1) i += 1;
    parts.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return parts.join(', ');
}
