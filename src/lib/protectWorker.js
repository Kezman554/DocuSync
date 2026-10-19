/**
 * Web Worker running pdfstudio (qpdf wasm) for protect.js. qpdf runs
 * synchronously inside the wasm, so keeping it here leaves the page
 * responsive on large files. Started on first use by protectClient.js.
 *
 * The wasm URL is passed explicitly: Vite pre-bundles pdfstudio in dev,
 * which breaks its own `new URL('./wasm/qpdf.wasm', import.meta.url)`
 * lookup; `?url` gives the right address in dev and in the built assets.
 */
import wasmUrl from 'pdfstudio/qpdf.wasm?url';
import { lockPdf, unlockPdf } from './protect.js';

let toolkit = null;

function getToolkit() {
  toolkit ??= import('pdfstudio').then(({ createPdfToolkit }) => createPdfToolkit({ wasmUrl }));
  return toolkit;
}

self.onmessage = async ({ data }) => {
  const { id, op, bytes, password, protection } = data;
  const stage = (name) => self.postMessage({ id, stage: name });
  try {
    stage('loading');
    const pdf = await getToolkit();
    stage('working');
    const result =
      op === 'lock' ? await lockPdf(pdf, bytes, protection) : await unlockPdf(pdf, bytes, password);
    self.postMessage({ id, ok: true, bytes: result }, result ? [result.buffer] : []);
  } catch (err) {
    // A failed load shouldn't stick: let the next request try again.
    if (!(err?.name === 'WrongPasswordError')) toolkit = null;
    self.postMessage({ id, ok: false, name: err?.name, message: err?.message ?? String(err) });
  }
};
