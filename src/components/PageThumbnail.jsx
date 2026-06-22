import { useEffect, useRef, useState } from 'react';
import { useInView } from '../hooks/useInView.js';

const THUMB_WIDTH = 140; // CSS px

/**
 * One page thumbnail. The page is only rendered to canvas once it scrolls
 * near view (lazy), so opening a long document doesn't render every page up
 * front. Clicking selects the page; the active thumbnail scrolls into view.
 */
function PageThumbnail({ pdfDoc, pageNumber, active, onSelect, root }) {
  const [ref, inView] = useInView({ root, rootMargin: '300px 0px' });
  const canvasRef = useRef(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!inView || !pdfDoc) return undefined;

    let cancelled = false;
    let renderTask = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const base = page.getViewport({ scale: 1 });
        const scale = THUMB_WIDTH / base.width;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const ctx = canvas.getContext('2d');
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
        if (!cancelled) setRendered(true);
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) {
          // eslint-disable-next-line no-console
          console.error(`Failed to render thumbnail ${pageNumber}`, err);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [inView, pdfDoc, pageNumber]);

  // Keep the selected page visible in the sidebar when navigated elsewhere.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active, ref]);

  return (
    <button
      ref={ref}
      type="button"
      className={`sidebar__thumb${active ? ' sidebar__thumb--active' : ''}`}
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      aria-label={`Page ${pageNumber}`}
    >
      <span
        className={`sidebar__thumb-preview${
          rendered ? ' sidebar__thumb-preview--ready' : ''
        }`}
      >
        <canvas ref={canvasRef} className="sidebar__thumb-canvas" />
      </span>
      <span className="sidebar__thumb-label">{pageNumber}</span>
    </button>
  );
}

export default PageThumbnail;
