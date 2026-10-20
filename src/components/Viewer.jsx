import { useEffect, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { effectiveRotation } from '../lib/pageModel.js';
import { fitWidthScale } from '../lib/zoom.js';
import EmptyState from './EmptyState.jsx';
import ToolRow from './ToolRow.jsx';
import AnnotationLayer from './AnnotationLayer.jsx';
import './Viewer.css';

function Viewer({ stampsOpen, onToggleStamps }) {
  const {
    hasDocument,
    status,
    error,
    sourcesById,
    currentPage,
    currentEntry,
    scale,
    unlocking,
    passwordRequest,
    sources,
    setZoom,
  } = useDocumentContext();
  // The current page may come from any of the merged source documents.
  const pdfDoc = sourcesById[currentEntry?.sourceId]?.pdfDoc ?? null;
  const canvasRef = useRef(null);
  const sourcePage = currentEntry?.sourcePage;
  const rotation = currentEntry?.rotation ?? 0;

  // The loaded page's PDF box and intrinsic /Rotate, which the annotation
  // layer needs to map between screen and PDF space. Tagged with the page it
  // belongs to so a stale value is never used while the next page loads.
  const [geometry, setGeometry] = useState(null);

  // A newly opened document starts fitted to the viewer's width when its
  // first page is wider than the viewer at 100%, so the page's left edge is
  // never cut off. Zoom can still take it back to 100%.
  const scrollRef = useRef(null);
  const docKey = sources[0]?.id ?? null;
  const fitPending = useRef(null);
  useEffect(() => {
    fitPending.current = docKey;
  }, [docKey]);
  useEffect(() => {
    if (!geometry || geometry.pdfDoc !== pdfDoc || !docKey || fitPending.current !== docKey) return;
    fitPending.current = null;
    const el = scrollRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const px = (v) => (v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v) || 0);
    const available = el.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
    const [x1, y1, x2, y2] = geometry.view;
    const turned = effectiveRotation(geometry.rotate, rotation) % 180 !== 0;
    const fit = fitWidthScale(turned ? y2 - y1 : x2 - x1, available);
    if (fit !== scale) setZoom(fit);
    // Only when a document's first page arrives, not on every zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, docKey]);

  useEffect(() => {
    if (!pdfDoc || !sourcePage) return undefined;

    let cancelled = false;
    let renderTask = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(sourcePage);
        if (cancelled) return;
        setGeometry((prev) =>
          prev?.pdfDoc === pdfDoc && prev.sourcePage === sourcePage
            ? prev
            : { pdfDoc, sourcePage, view: page.view, rotate: page.rotate || 0 }
        );

        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({
          scale,
          rotation: effectiveRotation(page.rotate, rotation),
        });
        const ctx = canvas.getContext('2d');

        // Backing store at device resolution for crisp output. The CSS size is
        // exact (not floored) so the annotation layer lines up precisely.
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        renderTask = page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
      } catch (err) {
        // RenderingCancelledException is expected when page/scale changes mid-render.
        if (err?.name !== 'RenderingCancelledException' && !cancelled) {
          // eslint-disable-next-line no-console
          console.error('Failed to render page', err);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, sourcePage, rotation, scale]);

  const toolRow = <ToolRow stampsOpen={stampsOpen} onToggleStamps={onToggleStamps} />;

  if (!hasDocument) {
    return (
      <section className="viewer" aria-label="Document viewer">
        {toolRow}
        <div className="viewer__empty">
          {status === 'loading' ? (
            <p className="viewer__status" role="status">
              {unlocking
                ? `Unlocking “${unlocking.name}”…`
                : passwordRequest
                  ? `Waiting for the password for “${passwordRequest.name}”…`
                  : 'Loading PDF…'}
            </p>
          ) : status === 'error' ? (
            <div className="viewer__status viewer__status--error">
              <p>Couldn’t open that PDF.</p>
              {error && <p className="viewer__error-detail">{error}</p>}
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="viewer" aria-label="Document viewer">
      {toolRow}
      <div className="viewer__scroll" ref={scrollRef}>
        <div className="viewer__page">
          <canvas
            ref={canvasRef}
            className="viewer__canvas"
            aria-label={`Page ${currentPage}`}
          />
          {geometry?.pdfDoc === pdfDoc && geometry.sourcePage === sourcePage && (
            <AnnotationLayer
              entry={currentEntry}
              pageNumber={currentPage}
              view={geometry.view}
              intrinsicRotate={geometry.rotate}
              scale={scale}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export default Viewer;
