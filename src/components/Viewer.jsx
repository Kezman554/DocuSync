import { useEffect, useRef } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import EmptyState from './EmptyState.jsx';
import PageControls from './PageControls.jsx';
import './Viewer.css';

function Viewer() {
  const { hasDocument, status, error, pdfDoc, currentPage, scale } =
    useDocumentContext();
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!pdfDoc) return undefined;

    let cancelled = false;
    let renderTask = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext('2d');

        // Backing store at device resolution for crisp output; CSS size in CSS px.
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

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
  }, [pdfDoc, currentPage, scale]);

  if (!hasDocument) {
    return (
      <section className="viewer viewer--empty" aria-label="Document viewer">
        {status === 'loading' ? (
          <p className="viewer__status">Loading PDF…</p>
        ) : status === 'error' ? (
          <div className="viewer__status viewer__status--error">
            <p>Couldn’t open that PDF.</p>
            {error && <p className="viewer__error-detail">{error}</p>}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>
    );
  }

  return (
    <section className="viewer" aria-label="Document viewer">
      <div className="viewer__scroll">
        <canvas
          ref={canvasRef}
          className="viewer__canvas"
          aria-label={`Page ${currentPage}`}
        />
      </div>
      <PageControls />
    </section>
  );
}

export default Viewer;
