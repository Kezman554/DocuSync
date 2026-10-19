// Strict "is this text anywhere in the PDF?" checks, shared by the redaction
// and excluded-page leak tests. Node only (zlib, Buffer).
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

/**
 * Every place `word` could hide in the file: the raw bytes, every object
 * (including dicts packed in object streams) and every stream decoded — as
 * plain text, as the hex strings pdf-lib's drawText writes (<48656C6C6F>
 * Tj), or as UTF-16BE hex (how pdf-lib stores form-field values).
 */
export async function fileContains(bytes, word) {
  const hexes = [
    Buffer.from(word, 'latin1').toString('hex'),
    Buffer.from(word, 'utf16le').swap16().toString('hex'),
  ];
  const haystacks = [Buffer.from(bytes).toString('latin1')];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) {
      haystacks.push(object.toString());
      continue;
    }
    const filter = object.dict.get(PDFName.of('Filter'));
    let data = Buffer.from(object.contents);
    if (filter?.toString() === '/FlateDecode') {
      try {
        data = inflateSync(data);
      } catch {
        continue; // not flate after all; raw bytes were searched above
      }
    }
    haystacks.push(data.toString('latin1'));
  }
  return haystacks.some(
    (h) => h.includes(word) || hexes.some((hex) => h.toLowerCase().includes(hex))
  );
}

/**
 * All text pdf.js can extract from the file: page text, plus annotation
 * contents and form-field values. `loadPdf(bytes)` opens it with pdf.js.
 */
export async function extractedText(loadPdf, bytes) {
  const pdf = await loadPdf(bytes);
  const parts = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    parts.push(...(await page.getTextContent()).items.map((item) => item.str));
    for (const a of await page.getAnnotations()) {
      parts.push(a.contentsObj?.str ?? '', String(a.fieldValue ?? ''));
    }
  }
  await pdf.destroy();
  return parts.join(' ');
}

/** Present in the file in any form: extraction, or any object or stream. */
export async function leaks(loadPdf, bytes, word) {
  return (await extractedText(loadPdf, bytes)).includes(word) || fileContains(bytes, word);
}
