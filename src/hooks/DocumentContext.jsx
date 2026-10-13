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
  // select | marker | text | image | stamp
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
   * Load `files` with pdf.js, giving each a new source id. Files that fail
   * are reported in `failures` rather than aborting the rest.
   */
  const loadSources = useCallback(async (files) => {
    const results = await Promise.allSettled(files.map((f) => loadPdfDocument(f)));
    const loaded = [];
    const failures = [];
    results.forEach((result, i) => {
      const file = files[i];
      if (result.status === 'fulfilled') {
        const pdfDoc = result.value;
        loaded.push({
          id: `s${nextSourceRef.current++}`,
          name: file.name,
          size: file.size,
          numPages: pdfDoc.numPages,
          pdfDoc,
          file,
        });
      } else {
        failures.push({ name: file.name, message: result.reason?.message });
      }
    });
    return { loaded, failures };
  }, []);

  /** Open one or more PDFs as a new document (several are merged, in order). */
  const openDocuments = useCallback(
    async (files) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      const token = (loadTokenRef.current += 1);
      setStatus('loading');
      setError(null);

      const { loaded, failures } = await loadSources(list);
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
      setNotice(failures.length ? describeFailures(failures) : null);
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

      const { loaded, failures } = await loadSources(list);
      if (loadTokenRef.current !== token) {
        loaded.forEach((src) => src.pdfDoc?.destroy?.());
        return;
      }
      setAdding(false);
      if (failures.length) setNotice(describeFailures(failures));
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
      return buildPdf(inputs, entries, { pageNumbers, watermark: watermarkOption });
    },
    [pages, sourcesById, numbering, numberLabels, watermark, watermarkApplies]
  );

  /**
   * Build a PDF from `entries` (a slice of the page model) and download it.
   * Shared by full export and page extraction. Resolves true on success.
   * `makeFileName(primaryName, merged)` names the download.
   */
  const runExport = useCallback(
    async (positions, makeFileName) => {
      const entries = positions.map((n) => pages[n - 1]).filter(Boolean);
      if (!primary || entries.length === 0) return false;
      const token = loadTokenRef.current;
      setExporting(true);
      setNotice(null);
      try {
        const usedIds = [...new Set(entries.map((p) => p.sourceId))];
        const bytes = await buildBytes(positions);
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
   * optional metadata strip, unused objects dropped) and download it.
   * Resolves the size report ({ before, after, images, reencoded }) — where
   * `before` is the same export uncompressed — or null on failure. If
   * compression doesn't help, the uncompressed export is downloaded.
   */
  const compressDocument = useCallback(
    async ({ preset, stripMetadata }, onProgress) => {
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
        if (loadTokenRef.current !== token) return null;
        const smaller = result.after < result.before;
        downloadBytes(smaller ? result.bytes : exported, compressedFileName(primary.name));
        return { ...result, after: smaller ? result.after : result.before, bytes: undefined };
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
