/**
 * Stamp model: reusable marks the user places on pages. Pure module.
 *
 *   {
 *     id: string,
 *     kind: 'tick' | 'initials' | 'signature',
 *     name: string,
 *     content:
 *       | { type: 'text', text, font, fontSize, color }   → placed as a text
 *         annotation (vector, via lib/textLayout.js + drawText)
 *       | { type: 'image', mime, bytes, width, height }   → placed as an image
 *         annotation (PNG/JPEG via drawImage)
 *     builtIn?: true,            shipped presets — not stored, not deletable
 *     createdAt?: number,        set by the store for user stamps
 *     updatedAt?: number,
 *   }
 *
 * User stamps live in IndexedDB (lib/stampStore.js); presets live here.
 */
import { sniffImage } from './imageInfo.js';
import { STANDARD_FONTS } from './textLayout.js';

export const STAMP_KINDS = ['tick', 'initials', 'signature'];

/** Built-in tick presets, drawn with the ZapfDingbats standard font. */
export const BUILT_IN_STAMPS = [
  ['tick', 'Tick', '✔', '#1a7f37'],
  ['tick-light', 'Light tick', '✓', '#1a7f37'],
  ['cross', 'Cross', '✘', '#cf222e'],
  ['dot', 'Dot', '●', '#000000'],
].map(([id, name, text, color]) => ({
  id: `builtin-${id}`,
  kind: 'tick',
  name,
  builtIn: true,
  content: { type: 'text', text, font: 'ZapfDingbats', fontSize: 24, color },
}));

/** Built-in looks for initials stamps (the initials themselves are the user's). */
export const INITIALS_PRESETS = [
  { id: 'script', label: 'Script', font: 'TimesRomanBoldItalic' },
  { id: 'classic', label: 'Classic', font: 'TimesRoman' },
  { id: 'plain', label: 'Plain', font: 'Helvetica' },
];

export const INITIALS_FONT_SIZE = 20;
const MAX_INITIALS_LETTERS = 4;
const MAX_NAME_LENGTH = 60;

/**
 * Clean up typed initials: letters (any alphabet the standard fonts cover),
 * optional dots/hyphens; upper-cased; at most 4 letters.
 * @returns {{ value: string } | { error: string }}
 */
export function normalizeInitials(input) {
  const value = String(input ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (!value) return { error: 'Type your initials, e.g. NY' };
  if (!/^[\p{L}.\-]+$/u.test(value)) return { error: 'Use letters only (dots and hyphens are fine)' };
  const letters = value.replace(/[.\-]/g, '').length;
  if (letters === 0) return { error: 'Type your initials, e.g. NY' };
  if (letters > MAX_INITIALS_LETTERS) return { error: `Up to ${MAX_INITIALS_LETTERS} letters` };
  return { value };
}

/** Trim a stamp name to something displayable. */
export function cleanName(name, fallback = 'Stamp') {
  const trimmed = String(name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || fallback;
}

/** A new (unsaved) initials stamp in one of the preset looks. */
export function createInitialsStamp(initials, presetId = 'script', color = '#000000') {
  const result = normalizeInitials(initials);
  if (result.error) throw new Error(result.error);
  const preset = INITIALS_PRESETS.find((p) => p.id === presetId) ?? INITIALS_PRESETS[0];
  return {
    kind: 'initials',
    name: result.value,
    content: {
      type: 'text',
      text: result.value,
      font: preset.font,
      fontSize: INITIALS_FONT_SIZE,
      color,
    },
  };
}

/**
 * A new (unsaved) image stamp, e.g. a signature, from PNG/JPEG bytes.
 * Throws if the bytes aren't a PNG or JPEG.
 */
export function createImageStamp(bytes, { name, kind = 'signature' } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const info = sniffImage(data);
  if (!info) throw new Error('Only PNG and JPG images can be saved as stamps');
  return {
    kind: STAMP_KINDS.includes(kind) ? kind : 'signature',
    name: cleanName(name, 'Signature'),
    content: { type: 'image', mime: info.mime, bytes: data, width: info.width, height: info.height },
  };
}

/**
 * Normalise a record read back from storage: image bytes may come back as
 * an ArrayBuffer, or as a typed array from another JS realm (structured
 * clone), which fails `instanceof Uint8Array` here and in pdf-lib. Copy them
 * into a plain Uint8Array of this realm. Other records pass through.
 */
export function normalizeStampRecord(record) {
  const bytes = record?.content?.bytes;
  if (record?.content?.type !== 'image' || bytes == null) return record;
  const isBuffer = Object.prototype.toString.call(bytes) === '[object ArrayBuffer]';
  if (!isBuffer && !ArrayBuffer.isView(bytes)) return record;
  const copy = isBuffer
    ? new Uint8Array(bytes.slice(0))
    : new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...record, content: { ...record.content, bytes: copy } };
}

/** Whether a record read back from storage is a usable stamp. */
export function isValidStamp(stamp) {
  if (!stamp || typeof stamp !== 'object') return false;
  if (typeof stamp.id !== 'string' || !STAMP_KINDS.includes(stamp.kind)) return false;
  if (typeof stamp.name !== 'string') return false;
  const c = stamp.content;
  if (c?.type === 'text') {
    return (
      typeof c.text === 'string' &&
      c.text.length > 0 &&
      c.font in STANDARD_FONTS &&
      Number.isFinite(c.fontSize) &&
      typeof c.color === 'string'
    );
  }
  if (c?.type === 'image') {
    return c.bytes instanceof Uint8Array && sniffImage(c.bytes) !== null;
  }
  return false;
}

/** Realistic signing width for a placed signature, in points (~2¼ in). */
export const SIGNATURE_WIDTH_PT = 160;

/**
 * Default size (pt) for placing an image stamp of `width` × `height` px on a
 * page shown at `pageSize` (pt). Signatures get a realistic signing width;
 * other images use 1px = 1pt. Either way, at most 40% of the page.
 */
export function defaultStampSize({ kind, width, height }, pageSize, fraction = 0.4) {
  const target = kind === 'signature' ? SIGNATURE_WIDTH_PT / width : 1;
  const scale = Math.min(
    target,
    (pageSize.width * fraction) / width,
    (pageSize.height * fraction) / height
  );
  return { width: width * scale, height: height * scale };
}

/** What a placed stamp remembers about where it came from. */
export const stampOrigin = (stamp) => ({ id: stamp.id, kind: stamp.kind, name: stamp.name });
