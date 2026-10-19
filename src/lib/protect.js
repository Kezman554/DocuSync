/**
 * Password protection: lock (encrypt) on export, unlock (decrypt) on open,
 * with pdfstudio — qpdf compiled to WebAssembly. Runs entirely on the device.
 *
 * Everything here takes a pdfstudio toolkit (`createPdfToolkit()`) rather
 * than importing pdfstudio, so detection stays cheap on the main thread and
 * the ~2 MB wasm only loads when a file is actually locked or unlocked. In
 * the browser these run in a worker (protectWorker.js via protectClient.js);
 * tests call them directly in Node.
 */

/** The password given (or none, for a file that needs one) didn't open the file. */
export class WrongPasswordError extends Error {
  constructor(message = 'That password didn’t open the file.') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}

/** Below this many characters, the dialog warns the password is guessable. */
export const SHORT_PASSWORD = 10;

const ENCRYPT = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
const isNameChar = (byte) =>
  (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);

/**
 * Whether a file declares encryption, without parsing it: an encrypted PDF's
 * trailer (or cross-reference stream dictionary) holds /Encrypt, and those
 * are never compressed or encrypted, so the bytes always show it. A stray
 * match elsewhere only costs a check with qpdf (unlockPdf returns null).
 */
export function looksEncrypted(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const last = data.length - ENCRYPT.length;
  outer: for (let i = data.indexOf(0x2f); i !== -1 && i <= last; i = data.indexOf(0x2f, i + 1)) {
    for (let k = 1; k < ENCRYPT.length; k += 1) if (data[i + k] !== ENCRYPT[k]) continue outer;
    if (!isNameChar(data[i + ENCRYPT.length])) return true; // not /EncryptMetadata
  }
  return false;
}

/**
 * The settings the export dialog collects:
 *   { openPassword, repeatPassword, ownerPassword,
 *     allowPrinting, allowCopying, allowEditing }
 */
export const DEFAULT_PROTECTION = {
  openPassword: '',
  repeatPassword: '',
  ownerPassword: '',
  allowPrinting: true,
  allowCopying: true,
  allowEditing: true,
};

/** Restrictions only mean something with a separate owner password. */
export const hasOwnerPassword = (p) =>
  Boolean(p.ownerPassword) && p.ownerPassword !== p.openPassword;

/** Why the settings can't be used yet (user-facing), or null. */
export function protectionError(p) {
  if (!p.openPassword) return 'Enter a password for opening the file.';
  if (p.repeatPassword !== p.openPassword) return 'The two passwords don’t match.';
  return null;
}

/**
 * Dialog settings → pdfstudio lock() options. Always AES-256. Without an
 * owner password, pdfstudio makes the open password the owner password too,
 * which grants full access — so restrictions are only sent with one.
 */
export function lockOptions(p) {
  const options = { userPassword: p.openPassword, keyLength: 256 };
  if (!hasOwnerPassword(p)) return options;
  return {
    ...options,
    ownerPassword: p.ownerPassword,
    permissions: {
      print: p.allowPrinting ? 'full' : 'none',
      extract: Boolean(p.allowCopying),
      modify: p.allowEditing ? 'all' : 'none',
    },
  };
}

/** Encrypt `bytes` with the dialog's settings. */
export async function lockPdf(toolkit, bytes, protection) {
  const error = protectionError(protection);
  if (error) throw new Error(error);
  return toolkit.lock(bytes, lockOptions(protection));
}

/**
 * Decrypt `bytes` with `password` ('' for a file that only has an owner
 * password, which opens without one). Resolves the decrypted bytes, or null
 * if the file isn't encrypted after all; rejects with WrongPasswordError.
 */
export async function unlockPdf(toolkit, bytes, password) {
  if (!(await toolkit.isEncrypted(bytes))) return null;
  try {
    return await toolkit.unlock(bytes, { password });
  } catch (err) {
    if (err?.name === 'PdfPasswordError') throw new WrongPasswordError();
    throw err;
  }
}

/** "report.pdf" → "report-protected.pdf". */
export function protectedFileName(name) {
  return `${(name || 'document').replace(/\.pdf$/i, '')}-protected.pdf`;
}
