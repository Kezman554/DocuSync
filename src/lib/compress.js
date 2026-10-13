/**
 * Light, browser-side PDF compression.
 *
 * Three passes over an (already exported) PDF:
 *  1. Re-encode embedded raster images as JPEG at a chosen quality, scaled
 *     so the longest side fits the preset. Only images we can decode and
 *     reproduce faithfully are touched (8-bit Gray/RGB, JPEG or Flate/LZW
 *     with optional PNG/TIFF predictors); masks, CMYK, JPEG 2000, colour-key
 *     masks and custom Decode arrays are left alone. A re-encode is kept
 *     only if it's smaller.
 *  2. Optionally strip metadata: the document info dictionary, XMP
 *     /Metadata streams, /PieceInfo and page /Thumb images.
 *  3. Drop every object no longer reachable from the trailer.
 *
 * Text and vector content are never rasterised. The pixel work itself
 * (decode + canvas JPEG encode) is injected as `encodeImage`, so this module
 * stays pure; the browser implementation is in compressBrowser.js.
 *
 * pdf-lib is imported lazily, as for export.
 */

export const COMPRESSION_PRESETS = {
  light: {
    id: 'light',
    label: 'Light',
    note: 'best quality, smaller saving',
    quality: 0.85,
    maxSide: 3000,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    note: 'good quality for screen and print',
    quality: 0.7,
    maxSide: 2000,
  },
  strong: {
    id: 'strong',
    label: 'Strong',
    note: 'smallest file, softer images',
    quality: 0.5,
    maxSide: 1400,
  },
};

export const DEFAULT_PRESET = 'balanced';

/** Image streams smaller than this aren't worth re-encoding (icons, rules). */
export const MIN_IMAGE_BYTES = 2048;

/**
 * @param {Uint8Array|ArrayBuffer} bytes  the PDF to compress
 * @param {{ quality: number, maxSide: number, stripMetadata?: boolean }} options
 * @param {(input: { type: 'jpeg', bytes: Uint8Array, width: number, height: number }
 *               | { type: 'pixels', data: Uint8ClampedArray, width: number, height: number },
 *          opts: { quality: number, maxSide: number })
 *          => Promise<{ bytes: Uint8Array, width: number, height: number } | null>} encodeImage
 *   decodes the input (JPEG bytes or RGBA pixels), scales it to fit `maxSide`
 *   and returns baseline JPEG bytes; null to leave the image unchanged
 * @param {(done: number, total: number) => void} [onProgress] per image
 * @returns {Promise<{ bytes: Uint8Array, before: number, after: number,
 *   images: number, reencoded: number, removedObjects: number }>}
 */
export async function compressPdf(bytes, options, encodeImage, onProgress) {
  const pdfLib = await import('pdf-lib');
  const { PDFDocument } = pdfLib;
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  const { context } = doc;

  const candidates = imageStreams(context, pdfLib);
  let reencoded = 0;
  for (const [index, { ref, stream }] of candidates.entries()) {
    const replacement = await reencodeImage(stream, options, encodeImage, context, pdfLib);
    if (replacement) {
      context.assign(ref, replacement);
      reencoded += 1;
    }
    onProgress?.(index + 1, candidates.length);
  }

  if (options.stripMetadata) stripMetadata(context, pdfLib);
  const removedObjects = pruneUnreachable(context, pdfLib);

  const out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  return {
    bytes: out,
    before: input.length,
    after: out.length,
    images: candidates.length,
    reencoded,
    removedObjects,
  };
}

/** Every indirect image XObject stream that isn't itself a soft mask. */
function imageStreams(context, { PDFName, PDFRawStream, PDFRef }) {
  const softMasks = new Set();
  const images = [];
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    images.push({ ref, stream: object });
    const smask = object.dict.get(PDFName.of('SMask'));
    if (smask instanceof PDFRef) softMasks.add(smask.tag);
  }
  return images.filter(({ ref }) => !softMasks.has(ref.tag));
}

/**
 * Decide whether `stream` can be re-encoded and, if so, return a new JPEG
 * image stream to replace it (or null to keep the original).
 */
async function reencodeImage(stream, { quality, maxSide }, encodeImage, context, pdfLib) {
  const { PDFName, PDFNumber, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } = pdfLib;
  const { dict, contents } = stream;
  if (contents.length < MIN_IMAGE_BYTES) return null;

  const get = (key) => dict.lookup(PDFName.of(key));
  const width = numberValue(get('Width'), PDFNumber);
  const height = numberValue(get('Height'), PDFNumber);
  if (!width || !height) return null;
  if (get('ImageMask')?.toString() === 'true') return null;
  if (get('Mask') instanceof PDFArray) return null; // colour-key masking needs exact colours
  if (get('Decode') !== undefined) return null;
  const smask = get('SMask');
  if (smask instanceof PDFRawStream && smask.dict.has(PDFName.of('Matte'))) return null;

  const components = colourComponents(get('ColorSpace'), pdfLib);
  if (components !== 1 && components !== 3) return null;

  const filters = filterNames(get('Filter'), PDFName, PDFArray);
  if (!filters) return null;

  let encoded;
  if (filters.length === 1 && filters[0] === 'DCTDecode') {
    // Baseline/progressive JPEG: the browser decodes the stream as-is.
    // Skip unusual colour transforms the browser might apply differently.
    if (get('DecodeParms') !== undefined) return null;
    encoded = await encodeImage(
      { type: 'jpeg', bytes: stripJpegMetadata(contents), width, height },
      { quality, maxSide }
    );
  } else {
    if (filters.some((f) => !RAW_FILTERS.has(f))) return null;
    if (numberValue(get('BitsPerComponent'), PDFNumber) !== 8) return null;
    let raw;
    try {
      raw = filters.length ? decodePDFRawStream(stream).decode() : contents;
    } catch {
      return null;
    }
    const parms = lastDecodeParms(get('DecodeParms'), PDFArray, PDFDict);
    const predictor = parms ? numberValue(parms.lookup(PDFName.of('Predictor')), PDFNumber) ?? 1 : 1;
    if (predictor > 1) {
      const colors = numberValue(parms.lookup(PDFName.of('Colors')), PDFNumber) ?? 1;
      const columns = numberValue(parms.lookup(PDFName.of('Columns')), PDFNumber) ?? 1;
      const bpc = numberValue(parms.lookup(PDFName.of('BitsPerComponent')), PDFNumber) ?? 8;
      if (colors !== components || columns !== width || bpc !== 8) return null;
      raw = unpredict(raw, { predictor, colors, columns, rows: height });
      if (!raw) return null;
    }
    if (raw.length < width * height * components) return null;
    encoded = await encodeImage(
      { type: 'pixels', data: toRgba(raw, width, height, components), width, height },
      { quality, maxSide }
    );
  }

  if (!encoded || encoded.bytes.length >= contents.length) return null;

  const next = dict.clone(context);
  next.set(PDFName.of('Width'), PDFNumber.of(encoded.width));
  next.set(PDFName.of('Height'), PDFNumber.of(encoded.height));
  next.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  next.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  next.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  next.set(PDFName.of('Length'), PDFNumber.of(encoded.bytes.length));
  next.delete(PDFName.of('DecodeParms'));
  return PDFRawStream.of(next, encoded.bytes);
}

const RAW_FILTERS = new Set(['FlateDecode', 'LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode']);

function numberValue(object, PDFNumber) {
  return object instanceof PDFNumber ? object.asNumber() : undefined;
}

/** Filter names as strings without the slash; null if malformed. */
function filterNames(filter, PDFName, PDFArray) {
  if (filter === undefined) return [];
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray) {
    const names = filter.asArray();
    return names.every((n) => n instanceof PDFName) ? names.map((n) => n.decodeText()) : null;
  }
  return null;
}

/** DecodeParms for the last filter in the chain (the one producing pixels). */
function lastDecodeParms(parms, PDFArray, PDFDict) {
  if (parms instanceof PDFDict) return parms;
  if (parms instanceof PDFArray && parms.size()) {
    const last = parms.lookup(parms.size() - 1);
    return last instanceof PDFDict ? last : undefined;
  }
  return undefined;
}

/**
 * Number of colour components for the colour spaces we can re-encode
 * (DeviceGray/RGB, CalGray/RGB, ICCBased with N 1 or 3); 0 otherwise.
 */
function colourComponents(space, { PDFName, PDFArray, PDFRawStream, PDFNumber }) {
  if (space instanceof PDFName) {
    const name = space.decodeText();
    if (name === 'DeviceGray' || name === 'G') return 1;
    if (name === 'DeviceRGB' || name === 'RGB') return 3;
    return 0;
  }
  if (space instanceof PDFArray && space.size() >= 1) {
    const family = space.lookup(0);
    if (!(family instanceof PDFName)) return 0;
    const name = family.decodeText();
    if (name === 'CalGray') return 1;
    if (name === 'CalRGB') return 3;
    if (name === 'ICCBased') {
      const profile = space.lookup(1);
      if (!(profile instanceof PDFRawStream)) return 0;
      const n = profile.dict.lookup(PDFName.of('N'));
      return n instanceof PDFNumber ? n.asNumber() : 0;
    }
  }
  return 0;
}

/** Expand 1- or 3-component 8-bit samples to RGBA. */
export function toRgba(raw, width, height, components) {
  const count = width * height;
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0, s = 0, d = 0; i < count; i += 1, d += 4) {
    if (components === 1) {
      const v = raw[s++];
      out[d] = v;
      out[d + 1] = v;
      out[d + 2] = v;
    } else {
      out[d] = raw[s++];
      out[d + 1] = raw[s++];
      out[d + 2] = raw[s++];
    }
    out[d + 3] = 255;
  }
  return out;
}

/**
 * Undo a Flate/LZW predictor for 8-bit samples: TIFF predictor 2 or PNG
 * predictors (10–15, a filter-type byte per row). Returns null if the data
 * is malformed.
 */
export function unpredict(data, { predictor, colors, columns, rows }) {
  const bpp = colors; // bytes per pixel at 8 bits per component
  const rowBytes = colors * columns;
  const out = new Uint8Array(rowBytes * rows);

  if (predictor === 2) {
    if (data.length < out.length) return null;
    for (let y = 0; y < rows; y += 1) {
      const start = y * rowBytes;
      for (let x = 0; x < rowBytes; x += 1) {
        const left = x >= bpp ? out[start + x - bpp] : 0;
        out[start + x] = (data[start + x] + left) & 0xff;
      }
    }
    return out;
  }
  if (predictor < 10) return null;

  if (data.length < (rowBytes + 1) * rows) return null;
  for (let y = 0; y < rows; y += 1) {
    const type = data[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const prev = dst - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = data[src + x];
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let value;
      switch (type) {
        case 0: value = raw; break;
        case 1: value = raw + a; break;
        case 2: value = raw + b; break;
        case 3: value = raw + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return null;
      }
      out[dst + x] = value & 0xff;
    }
  }
  return out;
}

/**
 * Remove APP1 (EXIF/XMP) and APP2 (ICC) segments from a JPEG. A PDF draws
 * DCT images with the colour space in its own dictionary and ignores EXIF
 * orientation, so decoding without them reproduces what a viewer shows.
 * Returns the input unchanged if it isn't a well-formed JPEG header.
 */
export function stripJpegMetadata(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const keep = [bytes.subarray(0, 2)];
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return bytes;
    const marker = bytes[pos + 1];
    if (marker === 0xda) break; // start of scan: the rest is image data
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (length < 2 || pos + 2 + length > bytes.length) return bytes;
    if (marker !== 0xe1 && marker !== 0xe2) keep.push(bytes.subarray(pos, pos + 2 + length));
    pos += 2 + length;
  }
  if (keep.length === 1 && pos === 2) return bytes;
  keep.push(bytes.subarray(pos));
  const total = keep.reduce((sum, part) => sum + part.length, 0);
  if (total === bytes.length) return bytes;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of keep) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Drop the info dictionary, XMP metadata, PieceInfo and page thumbnails. */
function stripMetadata(context, { PDFName, PDFDict, PDFStream }) {
  context.trailerInfo.Info = undefined;
  const metadata = PDFName.of('Metadata');
  const pieceInfo = PDFName.of('PieceInfo');
  const thumb = PDFName.of('Thumb');
  const page = PDFName.of('Page');
  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : null;
    if (!dict) continue;
    dict.delete(metadata);
    dict.delete(pieceInfo);
    if (dict.get(PDFName.of('Type')) === page) dict.delete(thumb);
  }
}

/**
 * Delete every indirect object not reachable from the trailer (Root, Info,
 * Encrypt). Returns how many were removed.
 */
export function pruneUnreachable(context, { PDFRef, PDFDict, PDFArray, PDFStream }) {
  const reachable = new Set();
  const queue = [];
  const visit = (object) => {
    if (object === undefined || object === null) return;
    if (object instanceof PDFRef) {
      if (reachable.has(object.tag)) return;
      reachable.add(object.tag);
      queue.push(context.lookup(object));
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) visit(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) visit(value);
    } else if (object instanceof PDFStream) {
      visit(object.dict);
    }
  };
  const { Root, Info, Encrypt } = context.trailerInfo;
  [Root, Info, Encrypt].forEach(visit);
  while (queue.length) visit(queue.pop());

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.tag)) {
      context.delete(ref);
      removed += 1;
    }
  }
  return removed;
}

/** 1536 → "1.5 KB", 2500000 → "2.4 MB". */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Percentage saved, rounded; negative if the file grew. */
export function savingPercent(before, after) {
  if (!before) return 0;
  return Math.round(((before - after) / before) * 100);
}

/** "report.pdf" → "report-compressed.pdf". */
export function compressedFileName(name) {
  return `${(name || 'document').replace(/\.pdf$/i, '')}-compressed.pdf`;
}
