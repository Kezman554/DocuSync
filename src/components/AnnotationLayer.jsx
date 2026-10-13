import { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import {
  DEFAULT_MARKER_SIZE,
  getAnnotations,
  moveRect,
  rectCenteredAt,
  rectFromPoints,
  resizeRect,
} from '../lib/annotations.js';
import {
  pageBoxFromView,
  pdfToViewportRect,
  viewportSize,
  viewportToPdfRect,
} from '../lib/coords.js';
import { effectiveRotation } from '../lib/pageModel.js';
import './AnnotationLayer.css';

const HANDLES = ['nw', 'ne', 'sw', 'se'];
/** A press that moves less than this (px) is a click, not a drag-to-draw. */
const CLICK_SLOP = 4;

/**
 * Interactive layer over the rendered page. Annotations are stored in PDF
 * space (lib/annotations.js) and projected to the screen for the current
 * zoom and rotation with lib/coords.js; every edit is made in screen pixels
 * and converted straight back, so positions stay anchored to the page.
 */
function AnnotationLayer({ entry, pageNumber, view: pdfView, intrinsicRotate, scale }) {
  const {
    tool,
    setTool,
    selectedAnnotationId,
    selectAnnotation,
    addAnnotation,
    updateAnnotationRect,
    deleteAnnotation,
  } = useDocumentContext();

  const view = useMemo(
    () => ({
      pageBox: pageBoxFromView(pdfView),
      scale,
      rotation: effectiveRotation(intrinsicRotate, entry.rotation),
    }),
    [pdfView, scale, intrinsicRotate, entry.rotation]
  );
  const bounds = viewportSize(view);
  const annotations = getAnnotations(entry);

  const layerRef = useRef(null);
  const dragRef = useRef(null); // current gesture, see onPointerDown
  const [draft, setDraft] = useState(null); // rect being drawn (px)

  // Focus a newly selected annotation so Delete / arrows work immediately.
  useEffect(() => {
    if (!selectedAnnotationId) return;
    const el = layerRef.current?.querySelector(
      `[data-annotation-id="${selectedAnnotationId}"]`
    );
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }, [selectedAnnotationId]);

  const localPoint = (event) => {
    const r = layerRef.current.getBoundingClientRect();
    return {
      x: Math.min(Math.max(event.clientX - r.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - r.top, 0), bounds.height),
    };
  };

  const startGesture = (event, gesture) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    layerRef.current.setPointerCapture?.(event.pointerId);
    dragRef.current = { ...gesture, start: localPoint(event) };
  };

  const commit = (id, rectPx) => updateAnnotationRect(id, viewportToPdfRect(rectPx, view));

  const handleLayerPointerDown = (event) => {
    if (tool === 'marker') {
      startGesture(event, { kind: 'draw' });
      const p = dragRef.current?.start;
      if (p) setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
    } else {
      selectAnnotation(null);
    }
  };

  const handleAnnotationPointerDown = (event, annotation, rectPx) => {
    if (tool === 'marker') return; // let the layer start a new marker
    selectAnnotation(annotation.id);
    startGesture(event, { kind: 'move', id: annotation.id, rect: rectPx });
  };

  const handleResizePointerDown = (event, annotation, rectPx, handle) => {
    startGesture(event, { kind: 'resize', id: annotation.id, rect: rectPx, handle });
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = localPoint(event);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (drag.kind === 'move') commit(drag.id, moveRect(drag.rect, dx, dy, bounds));
    else if (drag.kind === 'resize') {
      commit(drag.id, resizeRect(drag.rect, drag.handle, dx, dy, bounds));
    } else if (drag.kind === 'draw') setDraft(rectFromPoints(drag.start, p));
  };

  const endGesture = (event, cancelled = false) => {
    const drag = dragRef.current;
    dragRef.current = null;
    layerRef.current?.releasePointerCapture?.(event.pointerId);
    if (drag?.kind !== 'draw') return;

    setDraft(null);
    if (cancelled) return;
    const end = localPoint(event);
    const drawn = rectFromPoints(drag.start, end);
    // A click places a default-size marker centred on the pointer.
    const rectPx =
      drawn.width < CLICK_SLOP && drawn.height < CLICK_SLOP
        ? rectCenteredAt(
            drag.start,
            {
              width: DEFAULT_MARKER_SIZE.width * scale,
              height: DEFAULT_MARKER_SIZE.height * scale,
            },
            bounds
          )
        : drawn;
    addAnnotation(entry.id, viewportToPdfRect(rectPx, view));
    setTool('select');
  };

  const handleAnnotationKeyDown = (event, annotation, rectPx) => {
    const step = (event.shiftKey ? 10 : 1) * scale; // 1pt / 10pt
    const moves = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      commit(annotation.id, moveRect(rectPx, dx, dy, bounds));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteAnnotation(annotation.id);
      layerRef.current?.focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      selectAnnotation(null);
      layerRef.current?.focus({ preventScroll: true });
    }
  };

  const handleLayerKeyDown = (event) => {
    if (event.key === 'Escape' && tool === 'marker') {
      event.preventDefault();
      setTool('select');
    }
  };

  return (
    <div
      ref={layerRef}
      className={`annotation-layer${tool === 'marker' ? ' annotation-layer--placing' : ''}`}
      style={{ width: `${bounds.width}px`, height: `${bounds.height}px` }}
      role="group"
      aria-label={`Annotations on page ${pageNumber}`}
      aria-describedby="annotation-layer-hint"
      tabIndex={-1}
      onPointerDown={handleLayerPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endGesture(event)}
      onPointerCancel={(event) => endGesture(event, true)}
      onKeyDown={handleLayerKeyDown}
    >
      <span id="annotation-layer-hint" className="annotation-layer__sr-only">
        {tool === 'marker'
          ? 'Click to place a marker, or drag to draw one. Escape cancels.'
          : 'Select a marker to move it with the arrow keys or delete it.'}
      </span>

      {annotations.map((annotation, index) => {
        const rectPx = pdfToViewportRect(annotation.rect, view);
        const selected = annotation.id === selectedAnnotationId;
        const label = `Marker ${index + 1}`;
        return (
          <div
            key={annotation.id}
            data-annotation-id={annotation.id}
            className={`annotation annotation--${annotation.type}${
              selected ? ' annotation--selected' : ''
            }`}
            style={{
              left: `${rectPx.x}px`,
              top: `${rectPx.y}px`,
              width: `${rectPx.width}px`,
              height: `${rectPx.height}px`,
            }}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected}
            onPointerDown={(event) => handleAnnotationPointerDown(event, annotation, rectPx)}
            onFocus={() => {
              if (!selected && tool !== 'marker') selectAnnotation(annotation.id);
            }}
            onKeyDown={(event) => handleAnnotationKeyDown(event, annotation, rectPx)}
          >
            {selected && (
              <>
                {HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className={`annotation__handle annotation__handle--${handle}`}
                    data-handle={handle}
                    aria-hidden="true"
                    onPointerDown={(event) =>
                      handleResizePointerDown(event, annotation, rectPx, handle)
                    }
                  />
                ))}
                <button
                  type="button"
                  className="annotation__delete"
                  aria-label={`Delete ${label.toLowerCase()}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => deleteAnnotation(annotation.id)}
                >
                  ×
                </button>
              </>
            )}
          </div>
        );
      })}

      {draft && (
        <div
          className="annotation annotation--draft"
          style={{
            left: `${draft.x}px`,
            top: `${draft.y}px`,
            width: `${draft.width}px`,
            height: `${draft.height}px`,
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export default AnnotationLayer;
