import { useEffect, useRef, useState } from 'react';
import { useInView } from '../hooks/useInView.js';
import { effectiveRotation } from '../lib/pageModel.js';

const THUMB_WIDTH = 140; // CSS px

/**
 * One page thumbnail. The page is only rendered to canvas once it scrolls
 * near view (lazy), so opening a long document doesn't render every page up
 * front. Clicking selects the page; the active thumbnail scrolls into view.
 */
function PageThumbnail({
  pdfDoc,
  sourcePage,
  rotation,
  label,
  active,
  selected,
  dragging = false,
  onSelect,
  root,
  ...dragProps // draggable / onDragStart / onDragEnd from the sidebar
}) {
  const [ref, inView] = useInView({ root, rootMargin: '300px 0px' });
  const canvasRef = useRef(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!inView || !pdfDoc) return undefined;

    let cancelled = false;
    let renderTask = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(sourcePage);
        if (cancelled) return;

        // Fixed width, so a page rotated to landscape becomes a shorter thumb.
        const pageRotation = effectiveRotation(page.rotate, rotation);
        const base = page.getViewport({ scale: 1, rotation: pageRotation });
        const scale = THUMB_WIDTH / base.width;
        const viewport = page.getViewport({ scale, rotation: pageRotation });
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
          console.error(`Failed to render thumbnail ${label}`, err);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [inView, pdfDoc, sourcePage, rotation, label]);

  // Keep the selected page visible in the sidebar when navigated elsewhere.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active, ref]);

  return (
    <button
      ref={ref}
      type="button"
      className={`sidebar__thumb${active ? ' sidebar__thumb--active' : ''}${
        selected ? ' sidebar__thumb--selected' : ''
      }${dragging ? ' sidebar__thumb--dragging' : ''}`}
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      aria-pressed={selected}
      data-source-page={sourcePage}
      aria-label={`Page ${label}${rotation ? `, rotated ${rotation}°` : ''}`}
      {...dragProps}
    >
      <span
        className={`sidebar__thumb-preview${
          rendered ? ' sidebar__thumb-preview--ready' : ''
        }`}
      >
        <canvas ref={canvasRef} className="sidebar__thumb-canvas" />
      </span>
      <span className="sidebar__thumb-label">{label}</span>
    </button>
  );
}

export default PageThumbnail;
