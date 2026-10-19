/**
 * Browser side of password protection: sends lock/unlock jobs to
 * protectWorker.js. The worker — and with it pdfstudio's ~2 MB wasm — is
 * only started the first time a file is locked or unlocked.
 *
 * `onStage('loading' | 'working')` reports progress: qpdf gives none of its
 * own, so the stages are "fetching/compiling the engine" and "running it".
 */
import { WrongPasswordError } from './protect.js';

let worker = null;
let nextId = 0;
const pending = new Map();

function failAll(error) {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./protectWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    if (data.stage) {
      job.onStage?.(data.stage);
      return;
    }
    pending.delete(data.id);
    if (data.ok) job.resolve(data.bytes);
    else if (data.name === 'WrongPasswordError') job.reject(new WrongPasswordError());
    else job.reject(new Error(data.message || 'The encryption engine failed.'));
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    failAll(new Error('The encryption engine couldn’t be loaded.'));
  };
  return worker;
}

function run(message, onStage) {
  return new Promise((resolve, reject) => {
    const id = (nextId += 1);
    pending.set(id, { resolve, reject, onStage });
    getWorker().postMessage({ id, ...message });
  });
}

/** Encrypt PDF bytes with the export dialog's settings (protect.js). */
export const lockInBrowser = (bytes, protection, onStage) =>
  run({ op: 'lock', bytes, protection }, onStage);

/**
 * Decrypt PDF bytes. Resolves the decrypted bytes, or null if the file
 * wasn't encrypted; rejects with WrongPasswordError.
 */
export const unlockInBrowser = (bytes, password, onStage) =>
  run({ op: 'unlock', bytes, password }, onStage);
