// Measures every pair in DESIGN.md › Contrast, in both modes, from the
// values in src/styles/tokens.css (WCAG 2 relative-luminance formula).
// Fails under 4.5:1 for text and 3:1 for non-text.
//
//   npm run check:contrast            check tokens.css
//   node scripts/check-contrast.mjs <file.css>   check another copy

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = process.argv[2] ?? fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url));
const MODES = ['light', 'dark'];
const TEXT = 4.5;
const NON_TEXT = 3;

// Every role in DESIGN.md's token table; each mode must define all of them.
const ROLES = [
  'ground', 'surface', 'raised', 'well', 'text', 'text-secondary', 'accent',
  'accent-fill', 'on-accent', 'danger', 'divider', 'outline', 'selection-on-page',
  'scrim', 'shadow',
];

const grounds = ['ground', 'surface', 'raised', 'well'];
const sources = [1, 2, 3, 4, 5, 6].map((n) => `source-${n}`);

// [foreground, background, minimum, what it is]. Grouped by the colour
// tiers in DESIGN.md › What colour means.
const PAIRS = [
  // Plain text, and cautions: text-coloured notes (their outline edge is below).
  ...['text', 'text-secondary'].flatMap((fg) => grounds.map((bg) => [fg, bg, TEXT, 'text, caution note'])),
  ...grounds.map((bg) => ['outline', bg, NON_TEXT, 'control edge, caution note edge']),
  // Accent: the current thing, and offers (accent-outlined, e.g. re-lock).
  ...['ground', 'surface', 'raised'].map((bg) => ['accent', bg, TEXT, 'accent text']),
  ...grounds.map((bg) => ['accent', bg, NON_TEXT, 'accent edge, offer outline']),
  ['on-accent', 'accent-fill', TEXT, 'on-accent'],
  ['on-accent', 'accent-fill-hover', TEXT, 'on-accent, hovered'],
  // Danger: destructive actions, errors and redaction.
  ...grounds.map((bg) => ['danger', bg, TEXT, 'error text']),
  ...grounds.map((bg) => ['danger', bg, NON_TEXT, 'invalid field, error notice edge']),
  ['on-danger', 'danger', TEXT, 'Delete button, ×, Redacted badge'],
  ['on-danger', 'danger-fill-hover', TEXT, 'Delete button, ×, hovered'],
  // Chrome on the white page, and content colours.
  ['selection-on-page', 'page', NON_TEXT, 'selection on page'],
  ['on-paper', 'page', TEXT, 'text on paper'],
  ['on-paper-muted', 'page', TEXT, 'text on paper'],
  ...sources.map((bg) => ['on-source', bg, TEXT, 'source badge']),
];

/** Custom properties declared in each block whose selector matches. */
function readBlocks(css) {
  const blocks = {};
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = {};
    for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      props[name] = value.trim();
    }
    blocks[selector.trim()] = props;
  }
  return blocks;
}

function resolve(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`--${name} refers to itself`);
  const value = tokens[name];
  if (value === undefined) throw new Error(`--${name} is not defined`);
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(tokens, ref[1], new Set([...seen, name])) : value;
}

function parseColour(value) {
  let m = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  m = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m && (m[4] === undefined || Number(m[4]) === 1)) return m.slice(1, 4).map(Number);
  throw new Error(`${value} is not an opaque colour this script can measure`);
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const blocks = readBlocks(readFileSync(file, 'utf8'));
const shared = blocks[':root'] ?? {};
let failures = 0;

for (const mode of MODES) {
  const own = blocks[`:root[data-theme='${mode}']`] ?? blocks[`:root[data-theme="${mode}"]`];
  if (!own) {
    console.error(`✖ ${mode}: no :root[data-theme="${mode}"] block`);
    failures++;
    continue;
  }
  for (const role of ROLES) {
    if (!(role in own)) {
      console.error(`✖ ${mode}: --${role} is missing`);
      failures++;
    }
  }
  const tokens = { ...shared, ...own };
  console.log(`\n${mode}`);
  for (const [fg, bg, min, what] of PAIRS) {
    let ratio;
    try {
      ratio = contrast(parseColour(resolve(tokens, fg)), parseColour(resolve(tokens, bg)));
    } catch (error) {
      console.error(`  ✖ ${fg} on ${bg}: ${error.message}`);
      failures++;
      continue;
    }
    const ok = ratio >= min;
    if (!ok) failures++;
    const line = `  ${ok ? '✓' : '✖'} ${ratio.toFixed(2).padStart(5)}:1  ${fg} on ${bg}  (${what}, needs ${min}:1)`;
    (ok ? console.log : console.error)(line);
  }
}

if (failures) {
  console.error(`\n✖ ${failures} contrast problem${failures === 1 ? '' : 's'} in ${file}`);
  process.exit(1);
}
console.log(`\n✓ every pair passes in both modes`);
