import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { loadPdfDocument } from '../lib/pdfLoader.js';
import {
  DEFAULT_SCALE,
  clampPage,
  zoomIn as zoomInScale,
  zoomOut as zoomOutScale,
} from '../lib/zoom.js';
import {
  createPageModel,
  deletePages as deletePagesModel,
  movePages as movePagesModel,
  nextSelection,
  nudgePages as nudgePagesModel,
  rotatePages,
} from '../lib/pageModel.js';
import {
  buildPdf,
  exportFileName,
  ExportError,
  extractFileName,
} from '../lib/exportPdf.js';
import { downloadBytes } from '../lib/download.js';
import { flattenInBrowser } from '../lib/flattenBrowser.js';
import { redactedPositions } from '../lib/redaction.js';
import { WrongPasswordError, looksEncrypted, protectedFileName } from '../lib/protect.js';
import { lockInBrowser, unlockInBrowser } from '../lib/protectClient.js';
import { renderPdfToImages } from '../lib/renderPages.js';
import { IMAGE_FORMATS, imageFileName, zipFileName } from '../lib/imageExport.js';
import { createZip } from '../lib/zip.js';
import { COMPRESSION_PRESETS, compressPdf, compressedFileName } from '../lib/compress.js';
import { encodeImageAsJpeg } from '../lib/compressBrowser.js';
import { DEFAULT_NUMBERING, pageNumberLabels } from '../lib/pageNumbering.js';
import { DEFAULT_WATERMARK, watermarkApplies as watermarkAppliesFor } from '../lib/watermark.js';
import {
  addAnnotation as addAnnotationModel,
  findAnnotation,
  newAnnotationId,
  removeAnnotation as removeAnnotationModel,
  updateAnnotation as updateAnnotationModel,
} from '../lib/annotations.js';
import {
  DEFAULT_TEXT_STYLE,
  clampFontSize,
  rectFromTopLeft,
  textLayout,
  topLeftOf,
} from '../lib/textLayout.js';
import { measureTextWidth } from '../lib/measureText.js';
import { sniffImage } from '../lib/imageInfo.js';
import { stampOrigin } from '../lib/stamps.js';

/**
 * Shared application state for the loaded PDFs, page model, selection, and zoom.
 *
 * `sources` holds every loaded PDF (one normally; more after merging), each
 * with its read-only pdf.js proxy and original File. The page model is a
 * single ordered list of { id, sourceId, sourcePage, rotation } entries across
 * all sources, so pages can be reordered freely between documents.
 * `currentPage` is a 1-based position in that list.
 */
const DocumentContext = createContext(null);

/** The user closed the password prompt instead of unlocking the file. */
class PasswordCancelled extends Error {
  constructor() {
    super('it needs a password to open');
    this.name = 'PasswordCancelled';
  }
}

/** What to tell the user once encrypted files have been unlocked for editing. */
function describeUnlocked(unlocked) {
  return unlocked
    .map(({ name, needed }) =>
      needed
        ? `“${name}” is unlocked for editing. Exports won’t have its password unless you use Export with password….`
        : `“${name}” had restrictions on printing, copying or editing, removed so it can be edited. Exports won’t have them unless you use Export with password….`
    )
    .join(' ');
}

function describeFailures(failures) {
  if (failures.length === 1) {
    const [f] = failures;
    return `Couldn’t open “${f.name}”${f.message ? `: ${f.message}` : '.'}`;
  }
  return `Couldn’t open ${failures.length} files: ${failures
    .map((f) => `“${f.name}”`)
    .join(', ')}.`;
}

export function DocumentProvider({ children }) {
  // [{ id, name, size, numPages, pdfDoc, file }] — the first is the primary
  // document. The File is kept so export can re-read pristine bytes (pdf.js
  // transfers the buffer it was given to its worker, detaching it).
  const [sources, setSources] = useState([]);
  const [pages, setPages] = useState([]); // see lib/pageModel.js
  const [selected, setSelected] = useState(() => new Set()); // page ids
  const [anchorId, setAnchorId] = useState(null); // shift-click range anchor
  const [pendingDelete, setPendingDelete] = useState(null); // page ids awaiting confirmation
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState(null); // dismissible error message
  const [progress, setProgress] = useState(null); // { done, total } while rendering images
  // Image files waiting in the "Create a PDF from images" dialog.
  const [imagesToPdf, setImagesToPdf] = useState(null);
  // Page numbering for the document (null = off); see lib/pageNumbering.js.
  const [numbering, setNumbering] = useState(null);
  // Watermark for the document (null = off); see lib/watermark.js.
  const [watermark, setWatermark] = useState(null);
  // select | marker | text | image | stamp | redact
  const [tool, setToolState] = useState('select');
  // Image chosen with "Add image" (or an image stamp), waiting to be placed.
  const [pendingImage, setPendingImage] = useState(null);
  // Text stamp (tick, initials) placed with the stamp tool — stays armed so
  // it can be placed repeatedly until the tool changes.
  const [pendingStamp, setPendingStamp] = useState(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState(null);
  // Style for the next text box; also updated when a text box is restyled.
  const [textStyle, setTextStyle] = useState(DEFAULT_TEXT_STYLE);
  // Encrypted file waiting for the user: { id, name, kind: 'open' | 'owner',
  // attempt(password, onStage), cancel() } — 'owner' (owner password only)
  // adds confirmRight() for unlocking without the owner password.
  const [passwordRequest, setPasswordRequest] = useState(null);
  // Encrypted file being checked before the prompt: { name, stage }.
  const [unlocking, setUnlocking] = useState(null);
  const passwordRequestIdRef = useRef(0);

  // Track the most recent open/close so a slow load can't clobber a newer one.
  const loadTokenRef = useRef(0);
  const nextSourceRef = useRef(1);
  // Latest committed values, for async actions that finish later.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  // Object URLs for image previews, revoked when the document is closed.
  const imageUrlsRef = useRef(new Set());

  const revokeImageUrls = useCallback(() => {
    imageUrlsRef.current.forEach((url) => URL.revokeObjectURL?.(url));
    imageUrlsRef.current.clear();
  }, []);

  /** Switch tool; leaving the image/stamp tool drops what was waiting to be placed. */
  const setTool = useCallback((next) => {
    setToolState(next);
    if (next !== 'image') setPendingImage(null);
    if (next !== 'stamp') setPendingStamp(null);
  }, []);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const sourcesById = useMemo(
    () => Object.fromEntries(sources.map((src) => [src.id, src])),
    [sources]
  );
  const primary = sources[0] ?? null;
  const document = useMemo(
    () =>
      primary && {
        name: primary.name,
        size: primary.size,
        numPages: primary.numPages,
      },
    [primary]
  );

  const closeDocument = useCallback(() => {
    loadTokenRef.current += 1;
    sourcesRef.current.forEach((src) => src.pdfDoc?.destroy?.());
    setSources([]);
    setPages([]);
    setSelected(new Set());
    setAnchorId(null);
    setPendingDelete(null);
    setCurrentPage(1);
    setScale(DEFAULT_SCALE);
    setStatus('idle');
    setError(null);
    setAdding(false);
    setExporting(false);
    setNotice(null);
    setTool('select');
    setSelectedAnnotationId(null);
    setEditingAnnotationId(null);
    setNumbering(null);
    setWatermark(null);
    revokeImageUrls();
  }, [setTool, revokeImageUrls]);

  /**
   * Ask the user for `name`'s password until `tryPassword(password, onStage)`
   * succeeds (the dialog shows wrong ones and asks again) or they cancel.
   * For kind 'owner', confirming they have the right to edit the file
   * resolves `withoutPassword` (already decrypted with the empty password).
   */
  const askPassword = useCallback(
    (name, tryPassword, { kind = 'open', withoutPassword } = {}) =>
      new Promise((resolve, reject) => {
        const done = (bytes) => {
          setPasswordRequest(null);
          resolve(bytes);
        };
        setPasswordRequest({
          id: (passwordRequestIdRef.current += 1),
          name,
          kind,
          // A wrong password rejects to the dialog, which asks again.
          attempt: async (password, onStage) => done(await tryPassword(password, onStage)),
          ...(kind === 'owner' && { confirmRight: () => done(withoutPassword) }),
          cancel: () => {
            setPasswordRequest(null);
            reject(new PasswordCancelled());
          },
        });
      }),
    []
  );

  /**
   * If `file` is encrypted, decrypt it (pdfstudio, in a worker) and return a
   * File of the decrypted bytes, which then becomes the source the viewer,
   * page model and export all read. Either way the user is asked first: for
   * the open password, or — if only an owner password restricts the file —
   * for the owner password or confirmation they may edit it. Plain files
   * are returned as they are, without loading the decryption engine.
   */
  const prepareFile = useCallback(
    async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!looksEncrypted(bytes)) return { file };
      const decrypt = (password, onStage) => unlockInBrowser(bytes, password, onStage);
      // The empty password opens files that only have an owner password.
      let withoutPassword;
      let needed = false;
      setUnlocking({ name: file.name, stage: 'loading' });
      try {
        withoutPassword = await decrypt('', (stage) => setUnlocking({ name: file.name, stage }));
      } catch (err) {
        if (!(err instanceof WrongPasswordError)) throw err;
        needed = true;
      } finally {
        setUnlocking(null);
      }
      if (!needed && withoutPassword === null) return { file }; // only looked encrypted
      const plain = needed
        ? await askPassword(file.name, decrypt)
        : await askPassword(file.name, decrypt, { kind: 'owner', withoutPassword });
      return {
        file: new File([plain], file.name, { type: 'application/pdf' }),
        unlocked: { name: file.name, needed },
      };
    },
    [askPassword]
  );

  /**
   * Load `files` with pdf.js, giving each a new source id. Encrypted files
   * are unlocked first, one at a time (so only one password prompt shows).
   * Files that fail are reported in `failures` rather than aborting the
   * rest; `unlocked` lists the files that were decrypted.
   */
  const loadSources = useCallback(async (files) => {
    const prepared = [];
    for (const file of files) {
      try {
        prepared.push(await prepareFile(file));
      } catch (err) {
        prepared.push({ file, error: err });
      }
    }
    const results = await Promise.allSettled(
      prepared.map((p) => (p.error ? Promise.reject(p.error) : loadPdfDocument(p.file)))
    );
    const loaded = [];
    const failures = [];
    const unlocked = prepared.flatMap((p, i) =>
      p.unlocked && results[i].status === 'fulfilled' ? [p.unlocked] : []
    );
    results.forEach((result, i) => {
      const { file } = prepared[i];
      if (result.status === 'fulfilled') {
        const pdfDoc = result.value;
        loaded.push({
          id: `s${nextSourceRef.current++}`,
          name: file.name,
          size: file.size,
          numPages: pdfDoc.numPages,
          pdfDoc,
          file,
          // Was encrypted (open or owner password) before it was unlocked.
          protected: Boolean(prepared[i].unlocked),
        });
      } else {
        failures.push({ name: file.name, message: result.reason?.message });
      }
    });
    return { loaded, failures, unlocked };
  }, [prepareFile]);

  /** Open one or more PDFs as a new document (several are merged, in order). */
  const openDocuments = useCallback(
    async (files) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      const token = (loadTokenRef.current += 1);
      setStatus('loading');
      setError(null);

      const { loaded, failures, unlocked } = await loadSources(list);
      if (loadTokenRef.current !== token) {
        // A newer open/close happened while we were loading — discard this one.
        loaded.forEach((src) => src.pdfDoc?.destroy?.());
        return;
      }

      sourcesRef.current.forEach((src) => src.pdfDoc?.destroy?.());
      setPendingDelete(null);
      setTool('select');
      setSelectedAnnotationId(null);
      setEditingAnnotationId(null);
      setNumbering(null);
      setWatermark(null);
      revokeImageUrls();
      setAdding(false);
      setExporting(false);
      setScale(DEFAULT_SCALE);
      setCurrentPage(1);

      if (loaded.length === 0) {
        setError(failures[0]?.message ?? 'Failed to open PDF');
        setStatus('error');
        setSources([]);
        setPages([]);
        setSelected(new Set());
        setAnchorId(null);
        setNotice(null);
        return;
      }

      const model = loaded.flatMap((src) => createPageModel(src.numPages, src.id));
      setSources(loaded);
      setPages(model);
      setSelected(new Set([model[0].id]));
      setAnchorId(model[0].id);
      const messages = [
        failures.length && describeFailures(failures),
        unlocked.length && describeUnlocked(unlocked),
      ].filter(Boolean);
      setNotice(messages.length ? messages.join(' ') : null);
      setStatus('ready');
    },
    [loadSources, setTool, revokeImageUrls]
  );

  const openDocument = useCallback(
    (file) => (file ? openDocuments([file]) : undefined),
    [openDocuments]
  );

  /**
   * Merge: load more PDFs and append their pages to the end of the model.
   * The new pages become the selection and the first of them is shown.
   */
  const addDocuments = useCallback(
    async (files) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      if (sourcesRef.current.length === 0) {
        await openDocuments(list);
        return;
      }
      const token = loadTokenRef.current;
      setAdding(true);
      setNotice(null);

      const { loaded, failures, unlocked } = await loadSources(list);
      if (loadTokenRef.current !== token) {
        loaded.forEach((src) => src.pdfDoc?.destroy?.());
        return;
      }
      setAdding(false);
      const messages = [
        failures.length && describeFailures(failures),
        unlocked.length && describeUnlocked(unlocked),
      ].filter(Boolean);
      if (messages.length) setNotice(messages.join(' '));
      if (loaded.length === 0) return;

      const added = loaded.flatMap((src) => createPageModel(src.numPages, src.id));
      const before = pagesRef.current;
      setSources((prev) => [...prev, ...loaded]);
      setPages([...before, ...added]);
      setSelected(new Set(added.map((p) => p.id)));
      setAnchorId(added[0].id);
      setCurrentPage(before.length + 1);
    },
    [loadSources, openDocuments]
  );

  const numPages = pages.length;

  // Plain navigation moves the selection with it (single page selected).
  const goToPage = useCallback(
    (position) => {
      const p = clampPage(position, pages.length);
      setCurrentPage(p);
      const entry = pages[p - 1];
      if (entry) {
        setSelected(new Set([entry.id]));
        setAnchorId(entry.id);
      }
    },
    [pages]
  );
  const nextPage = useCallback(
    () => goToPage(currentPage + 1),
    [goToPage, currentPage]
  );
  const prevPage = useCallback(
    () => goToPage(currentPage - 1),
    [goToPage, currentPage]
  );

  /** Thumbnail click: update selection (Ctrl/Cmd toggles, Shift ranges) and show the page. */
  const selectPage = useCallback(
    (id, modifiers) => {
      const result = nextSelection(pages, selected, anchorId, id, modifiers);
      setSelected(result.selected);
      setAnchorId(result.anchorId);
      const index = pages.findIndex((p) => p.id === id);
      if (index !== -1) setCurrentPage(index + 1);
    },
    [pages, selected, anchorId]
  );

  // Page operations act on the selected pages, or the current page if none.
  const targetIds = useMemo(() => {
    if (selected.size > 0) return selected;
    const current = pages[currentPage - 1];
    return new Set(current ? [current.id] : []);
  }, [selected, pages, currentPage]);

  const rotateSelected = useCallback(
    (delta) => setPages((prev) => rotatePages(prev, targetIds, delta)),
    [targetIds]
  );
  const rotateLeft = useCallback(() => rotateSelected(-90), [rotateSelected]);
  const rotateRight = useCallback(() => rotateSelected(90), [rotateSelected]);

  // After a reorder, keep showing the same page (by id) at its new position.
  const applyReorder = useCallback(
    (next) => {
      if (next === pages) return;
      const currentId = pages[currentPage - 1]?.id;
      setPages(next);
      const index = next.findIndex((p) => p.id === currentId);
      if (index !== -1) setCurrentPage(index + 1);
    },
    [pages, currentPage]
  );

  /** Drag-drop: move `ids` to insertion index `toIndex` (see lib/pageModel.js). */
  const movePages = useCallback(
    (ids, toIndex) => applyReorder(movePagesModel(pages, ids, toIndex)),
    [applyReorder, pages]
  );

  /** Keyboard reorder: shift the target pages one slot up (-1) or down (+1). */
  const nudgeSelected = useCallback(
    (direction) => applyReorder(nudgePagesModel(pages, targetIds, direction)),
    [applyReorder, pages, targetIds]
  );

  // Deleting every page would leave nothing to view or export.
  const canDelete = targetIds.size > 0 && targetIds.size < pages.length;

  /** Ask for confirmation before deleting the target pages. */
  const requestDelete = useCallback(() => {
    if (canDelete) setPendingDelete([...targetIds]);
  }, [canDelete, targetIds]);
  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const next = deletePagesModel(pages, pendingDelete);
    setPendingDelete(null);
    if (next === pages || next.length === 0) return;

    // Stay on the current page if it survived; otherwise land on the page
    // that now occupies the first deleted slot (or the new last page).
    const currentId = pages[currentPage - 1]?.id;
    let index = next.findIndex((p) => p.id === currentId);
    if (index === -1) {
      const removed = new Set(pendingDelete);
      const firstRemoved = pages.findIndex((p) => removed.has(p.id));
      index = Math.min(firstRemoved, next.length - 1);
    }
    setPages(next);
    setCurrentPage(index + 1);
    setSelected(new Set([next[index].id]));
    setAnchorId(next[index].id);
  }, [pendingDelete, pages, currentPage]);

  // Each page's number label by position in the whole edited document.
  const numberLabels = useMemo(
    () => (numbering ? pageNumberLabels(pages.length, numbering) : null),
    [numbering, pages.length]
  );

  // Any loaded file had a password: exports without one should say so.
  const hadPassword = useMemo(() => sources.some((src) => src.protected), [sources]);

  // 1-based positions of pages with redaction boxes (flattened on export).
  const redactedPages = useMemo(() => redactedPositions(pages), [pages]);

  // Which pages (by position) get the watermark.
  const watermarkApplies = useMemo(
    () => (watermark ? watermarkAppliesFor(watermark.pages, pages.length) : null),
    [watermark, pages.length]
  );

  /**
   * Bake the pages at 1-based `positions` into new PDF bytes, reading only
   * the source files they use. Page numbers keep their position in the
   * whole document (so an extract of pages 3–4 reads "3", "4"). Shared by
   * PDF export, extraction and image export.
   */
  const buildBytes = useCallback(
    async (positions) => {
      const entries = positions.map((n) => pages[n - 1]).filter(Boolean);
      const inputs = {};
      for (const id of new Set(entries.map((p) => p.sourceId))) {
        const src = sourcesById[id];
        if (src) inputs[id] = { name: src.name, bytes: await src.file.arrayBuffer() };
      }
      const pageNumbers = numberLabels && {
        labels: positions.map((n) => numberLabels[n - 1] ?? null),
        style: { ...DEFAULT_NUMBERING, ...numbering },
      };
      const watermarkOption = watermarkApplies && {
        config: { ...DEFAULT_WATERMARK, ...watermark },
        applies: positions.map((n) => watermarkApplies[n - 1] ?? false),
      };
      return buildPdf(inputs, entries, {
        pageNumbers,
        watermark: watermarkOption,
        flatten: flattenInBrowser,
      });
    },
    [pages, sourcesById, numbering, numberLabels, watermark, watermarkApplies]
  );

  /**
   * Build a PDF from `entries` (a slice of the page model) and download it.
   * Shared by full export and page extraction. Resolves true on success.
   * `makeFileName(primaryName, merged)` names the download. With
   * `protection` (lib/protect.js) the finished PDF is encrypted as the very
   * last step; `onStage` reports the encryption engine's progress.
   */
  const runExport = useCallback(
    async (positions, makeFileName, { protection, onStage } = {}) => {
      const entries = positions.map((n) => pages[n - 1]).filter(Boolean);
      if (!primary || entries.length === 0) return false;
      const token = loadTokenRef.current;
      setExporting(true);
      setNotice(null);
      try {
        const usedIds = [...new Set(entries.map((p) => p.sourceId))];
        let bytes = await buildBytes(positions);
        if (protection) bytes = await lockInBrowser(bytes, protection, onStage);
        if (loadTokenRef.current !== token) return false; // document changed meanwhile
        downloadBytes(bytes, makeFileName(primary.name, usedIds.length > 1));
        return true;
      } catch (err) {
        if (loadTokenRef.current !== token) return false;
        // eslint-disable-next-line no-console
        console.error('Export failed', err);
        setNotice(
          err instanceof ExportError ? err.message : 'Export failed. Please try again.'
        );
        return false;
      } finally {
        if (loadTokenRef.current === token) setExporting(false);
      }
    },
    [primary, pages, buildBytes]
  );

  /**
   * PDF → images: render the pages at 1-based `positions` exactly as an
   * export would show them (order, rotation, annotations), as PNG/JPG at
   * `dpi`. One page downloads as an image; several as a ZIP.
   */
  const exportImages = useCallback(
    async (positions, { format, dpi }) => {
      const entries = positions.map((n) => pages[n - 1]).filter(Boolean);
      if (!primary || entries.length === 0) return false;
      const token = loadTokenRef.current;
      setExporting(true);
      setNotice(null);
      setProgress({ done: 0, total: entries.length });
      try {
        const pdfBytes = await buildBytes(positions);
        const images = await renderPdfToImages(pdfBytes, {
          format,
          dpi,
          onProgress: (done, total) => {
            if (loadTokenRef.current === token) setProgress({ done, total });
          },
        });
        if (loadTokenRef.current !== token) return false;
        const names = positions.map((n) => imageFileName(primary.name, n, pages.length, format));
        if (images.length === 1) {
          downloadBytes(images[0].bytes, names[0], IMAGE_FORMATS[format].mime);
        } else {
          const zip = createZip(images.map((img, i) => ({ name: names[i], bytes: img.bytes })));
          downloadBytes(zip, zipFileName(primary.name, positions, format), 'application/zip');
        }
        return true;
      } catch (err) {
        if (loadTokenRef.current !== token) return false;
        // eslint-disable-next-line no-console
        console.error('Image export failed', err);
        setNotice(
          err instanceof ExportError
            ? err.message
            : `Couldn’t export images${err?.message ? `: ${err.message}` : '.'}`
        );
        return false;
      } finally {
        if (loadTokenRef.current === token) {
          setExporting(false);
          setProgress(null);
        }
      }
    },
    [primary, pages, buildBytes]
  );

  /** Bake the whole page model into a new PDF and download it. */
  const exportDocument = useCallback(
    () =>
      runExport(
        pages.map((_, i) => i + 1),
        (name, merged) => exportFileName(name, { merged })
      ),
    [runExport, pages]
  );

  /** Export the whole document, encrypted with `protection` (lib/protect.js). */
  const exportProtected = useCallback(
    (protection, onStage) =>
      runExport(
        pages.map((_, i) => i + 1),
        (name) => protectedFileName(name),
        { protection, onStage }
      ),
    [runExport, pages]
  );

  /**
   * Split: extract the pages at 1-based `positions` (current edited order,
   * rotations included) into a new PDF and download it.
   */
  const extractPages = useCallback(
    (positions) => runExport(positions, (name) => extractFileName(name, positions)),
    [runExport]
  );
  const dismissNotice = useCallback(() => setNotice(null), []);

  /**
   * Compress the whole edited document (image re-encode at `preset`,
   * optional metadata strip, unused objects dropped) without downloading.
   * Resolves the report from compressPdf — `before` being the same export
   * uncompressed — plus `fileName` for saving `bytes`; null on failure.
   * With `protection`, the compressed result is then encrypted (last:
   * nothing can compress an encrypted file), and `after` is that size.
   */
  const compressDocument = useCallback(
    async ({ preset, stripMetadata, protection }, onProgress, onStage) => {
      const { quality, maxSide } = COMPRESSION_PRESETS[preset];
      if (!primary || pages.length === 0) return null;
      const token = loadTokenRef.current;
      setExporting(true);
      setNotice(null);
      try {
        const exported = await buildBytes(pages.map((_, i) => i + 1));
        const result = await compressPdf(
          exported,
          { quality, maxSide, stripMetadata },
          encodeImageAsJpeg,
          (done, total) => {
            if (loadTokenRef.current === token) onProgress?.(done, total);
          }
        );
        if (protection) {
          result.bytes = await lockInBrowser(result.bytes, protection, onStage);
          result.after = result.bytes.length;
        }
        if (loadTokenRef.current !== token) return null;
        return { ...result, fileName: compressedFileName(primary.name) };
      } catch (err) {
        if (loadTokenRef.current !== token) return null;
        // eslint-disable-next-line no-console
        console.error('Compression failed', err);
        setNotice(
          err instanceof ExportError ? err.message : 'Compression failed. Please try again.'
        );
        return null;
      } finally {
        if (loadTokenRef.current === token) setExporting(false);
      }
    },
    [primary, pages, buildBytes]
  );

  /** Open the images → PDF dialog with `files` (null closes it). */
  const requestImagesToPdf = useCallback((files) => {
    const list = Array.from(files ?? []);
    setImagesToPdf(list.length ? list : null);
  }, []);

  // --- Annotations (stored on page entries; see lib/annotations.js) -------

  /**
   * Add an annotation to page `pageId`. `fields` holds its type and data,
   * with `rect` in the PDF space of the page's source. Returns the new id.
   */
  const addAnnotation = useCallback((pageId, fields) => {
    const id = newAnnotationId();
    setPages((prev) => addAnnotationModel(prev, pageId, { ...fields, id }));
    setSelectedAnnotationId(id);
    return id;
  }, []);

  /**
   * Change a text annotation's text and/or style, re-measuring its box so
   * the text's top-left corner stays where it is.
   */
  const updateTextAnnotation = useCallback((id, patch) => {
    setPages((prev) => {
      const found = findAnnotation(prev, id);
      if (!found || found.annotation.type !== 'text') return prev;
      const next = { ...found.annotation, ...patch };
      if ('fontSize' in patch) next.fontSize = clampFontSize(patch.fontSize);
      const width = measureTextWidth(next.text, next.font, next.fontSize);
      const { height } = textLayout(next);
      const topLeft = topLeftOf(found.annotation.rect, found.annotation.rotate);
      next.rect = rectFromTopLeft(topLeft, next.rotate, width, height);
      return updateAnnotationModel(prev, id, next);
    });
  }, []);

  /** Merge `patch` into an annotation (e.g. { fontSize, rect } together). */
  const updateAnnotation = useCallback(
    (id, patch) => setPages((prev) => updateAnnotationModel(prev, id, patch)),
    []
  );

  const updateAnnotationRect = useCallback(
    (id, rect) => setPages((prev) => updateAnnotationModel(prev, id, { rect })),
    []
  );

  const deleteAnnotation = useCallback((id) => {
    setPages((prev) => removeAnnotationModel(prev, id));
    setSelectedAnnotationId((current) => (current === id ? null : current));
    setEditingAnnotationId((current) => (current === id ? null : current));
  }, []);

  const selectAnnotation = useCallback((id) => setSelectedAnnotationId(id), []);

  /**
   * Arm placement of a stamp from the library: image stamps use the image
   * tool (one placement), text stamps the stamp tool (repeatable).
   */
  const armStamp = useCallback(
    (stamp) => {
      if (!stamp) return;
      const { content } = stamp;
      if (content.type === 'image') {
        let url;
        if (typeof URL.createObjectURL === 'function') {
          url = URL.createObjectURL(new Blob([content.bytes], { type: content.mime }));
          imageUrlsRef.current.add(url);
        }
        setTool('image');
        // Same image id for every placement, so export embeds it once.
        setPendingImage({
          id: `stamp-${stamp.id}`,
          name: stamp.name,
          bytes: content.bytes,
          mime: content.mime,
          width: content.width,
          height: content.height,
          url,
          stamp: stampOrigin(stamp), // placed annotation remembers its stamp
        });
      } else {
        setTool('stamp');
        setPendingStamp(stamp);
      }
    },
    [setTool]
  );

  /**
   * Read a PNG/JPG for placement: check it by content, then arm the image
   * tool with it. Resolves false (with a notice) for anything else.
   */
  const loadImageFile = useCallback(
    async (file) => {
      if (!file) return false;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = sniffImage(bytes);
      if (!info) {
        setNotice(`“${file.name}” isn’t a PNG or JPG image, so it can’t be placed.`);
        return false;
      }
      let url;
      if (typeof URL.createObjectURL === 'function') {
        url = URL.createObjectURL(new Blob([bytes], { type: info.mime }));
        imageUrlsRef.current.add(url);
      }
      setNotice(null);
      setPendingImage({ id: newAnnotationId(), name: file.name, bytes, url, ...info });
      setTool('image');
      return true;
    },
    [setTool]
  );

  const zoomIn = useCallback(() => setScale((s) => zoomInScale(s)), []);
  const zoomOut = useCallback(() => setScale((s) => zoomOutScale(s)), []);
  const resetZoom = useCallback(() => setScale(DEFAULT_SCALE), []);

  const value = useMemo(
    () => ({
      document,
      sources,
      sourcesById,
      hasDocument: sources.length > 0,
      pages,
      numPages,
      currentPage,
      currentEntry: pages[currentPage - 1] ?? null,
      selected,
      targetIds,
      pendingDelete,
      canDelete,
      scale,
      status,
      error,
      adding,
      exporting,
      progress,
      notice,
      openDocument,
      openDocuments,
      addDocuments,
      closeDocument,
      goToPage,
      nextPage,
      prevPage,
      setCurrentPage,
      selectPage,
      rotateLeft,
      rotateRight,
      movePages,
      nudgeSelected,
      requestDelete,
      cancelDelete,
      confirmDelete,
      exportDocument,
      exportProtected,
      extractPages,
      exportImages,
      compressDocument,
      imagesToPdf,
      requestImagesToPdf,
      numbering,
      numberLabels,
      setNumbering,
      watermark,
      watermarkApplies,
      setWatermark,
      redactedPages,
      hadPassword,
      passwordRequest,
      unlocking,
      dismissNotice,
      tool,
      setTool,
      pendingImage,
      pendingStamp,
      armStamp,
      loadImageFile,
      selectedAnnotationId,
      selectAnnotation,
      addAnnotation,
      updateAnnotation,
      updateAnnotationRect,
      updateTextAnnotation,
      deleteAnnotation,
      editingAnnotationId,
      setEditingAnnotationId,
      textStyle,
      setTextStyle,
      zoomIn,
      zoomOut,
      resetZoom,
    }),
    [
      document,
      sources,
      sourcesById,
      pages,
      numPages,
      currentPage,
      selected,
      targetIds,
      pendingDelete,
      canDelete,
      scale,
      status,
      error,
      adding,
      exporting,
      progress,
      notice,
      openDocument,
      openDocuments,
      addDocuments,
      closeDocument,
      goToPage,
      nextPage,
      prevPage,
      selectPage,
      rotateLeft,
      rotateRight,
      movePages,
      nudgeSelected,
      requestDelete,
      cancelDelete,
      confirmDelete,
      exportDocument,
      exportProtected,
      extractPages,
      exportImages,
      compressDocument,
      imagesToPdf,
      requestImagesToPdf,
      numbering,
      numberLabels,
      setNumbering,
      watermark,
      watermarkApplies,
      setWatermark,
      redactedPages,
      hadPassword,
      passwordRequest,
      unlocking,
      dismissNotice,
      tool,
      setTool,
      pendingImage,
      pendingStamp,
      armStamp,
      loadImageFile,
      selectedAnnotationId,
      selectAnnotation,
      addAnnotation,
      updateAnnotation,
      updateAnnotationRect,
      updateTextAnnotation,
      deleteAnnotation,
      editingAnnotationId,
      setEditingAnnotationId,
      textStyle,
      setTextStyle,
      zoomIn,
      zoomOut,
      resetZoom,
    ]
  );

  return (
    <DocumentContext.Provider value={value}>
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocumentContext() {
  const ctx = useContext(DocumentContext);
  if (ctx === null) {
    throw new Error('useDocumentContext must be used within a DocumentProvider');
  }
  return ctx;
}

export default DocumentContext;
