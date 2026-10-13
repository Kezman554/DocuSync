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
  normalizeQuarterTurn,
  pageBoxFromView,
  pdfToViewportRect,
  viewportSize,
  viewportToPdfPoint,
  viewportToPdfRect,
} from '../lib/coords.js';
import { effectiveRotation } from '../lib/pageModel.js';
import { measureTextWidth } from '../lib/measureText.js';
import {
  LINE_HEIGHT,
  STANDARD_FONTS,
  ownSize,
  rectFromTopLeft,
  textLayout,
} from '../lib/textLayout.js';
import './AnnotationLayer.css';

const HANDLES = ['nw', 'ne', 'sw', 'se'];
/** A press that moves less than this (px) is a click, not a drag-to-draw. */
const CLICK_SLOP = 4;

const HINTS = {
  marker: 'Click to place a marker, or drag to draw one. Escape cancels.',
  text: 'Click where the text should start, then type. Escape cancels.',
  select:
    'Select an annotation to move it with the arrow keys or delete it. Press Enter to edit text.',
};

/**
 * Text annotation contents, drawn in its own (unrotated) frame and turned to
 * match the page. Lines are placed with the same layout the PDF export uses
 * (lib/textLayout.js), so baselines line up with the exported result.
 */
function TextContent({ annotation, boxPx, scale, pageRotation, editing, onChange, onDone }) {
  const own = ownSize(annotation.rect, annotation.rotate);
  const layout = textLayout(annotation);
  const font = STANDARD_FONTS[annotation.font] ?? STANDARD_FONTS.Helvetica;
  const width = own.width * scale;
  const height = own.height * scale;
  // The text was laid out upright for the page's rotation at the time; turn
  // it by however much the page has been rotated since.
  const turn = normalizeQuarterTurn(pageRotation - annotation.rotate);

  const style = {
    left: `${(boxPx.width - width) / 2}px`,
    top: `${(boxPx.height - height) / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    transform: turn ? `rotate(${turn}deg)` : undefined,
  };

  return (
    <div className="annotation__content" style={style} data-turn={turn}>
      {editing ? (
        <textarea
          className="annotation__editor"
          value={annotation.text}
          aria-label="Text"
          wrap="off"
          spellCheck
          autoFocus
          style={{
            fontFamily: font.css,
            fontSize: `${annotation.fontSize * scale}px`,
            lineHeight: `${annotation.fontSize * LINE_HEIGHT * scale}px`,
            color: annotation.color,
          }}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onDone}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation(); // keep arrows/Delete for the text
            if (event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <svg
          className="annotation__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${own.width} ${own.height}`}
          aria-hidden="true"
        >
          {layout.lines.map((line, i) => (
            <text
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              x={0}
              y={layout.baselines[i]}
              fontFamily={font.css}
              fontSize={annotation.fontSize}
              fill={annotation.color}
              xmlSpace="preserve"
            >
              {line}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

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
    updateTextAnnotation,
    deleteAnnotation,
    editingAnnotationId,
    setEditingAnnotationId,
    textStyle,
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
  const dragRef = useRef(null); // current gesture, see startGesture
  const [draft, setDraft] = useState(null); // marker being drawn (px)

  // Focus a newly selected annotation so Delete / arrows work immediately
  // (a text box being edited focuses its textarea instead).
  useEffect(() => {
    if (!selectedAnnotationId || selectedAnnotationId === editingAnnotationId) return;
    const el = layerRef.current?.querySelector(
      `[data-annotation-id="${selectedAnnotationId}"]`
    );
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [selectedAnnotationId, editingAnnotationId]);

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

  const placeText = (point) => {
    // The click is the text's top-left; it reads upright on the page as shown.
    const { font, fontSize, color } = textStyle;
    const rotate = view.rotation;
    const rect = rectFromTopLeft(
      viewportToPdfPoint(point, view),
      rotate,
      measureTextWidth('', font, fontSize),
      textLayout({ text: '', font, fontSize }).height
    );
    const id = addAnnotation(entry.id, { type: 'text', text: '', font, fontSize, color, rotate, rect });
    setEditingAnnotationId(id);
  };

  const handleLayerPointerDown = (event) => {
    if (tool === 'marker' || tool === 'text') {
      startGesture(event, { kind: tool === 'marker' ? 'draw' : 'text' });
      const p = dragRef.current?.start;
      if (p && tool === 'marker') setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
    } else {
      selectAnnotation(null);
    }
  };

  const handleAnnotationPointerDown = (event, annotation, rectPx) => {
    if (tool !== 'select') return; // let the layer place a new annotation
    if (annotation.id === editingAnnotationId) return; // clicking inside the editor
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
    if (!drag || cancelled) {
      setDraft(null);
      return;
    }
    if (drag.kind === 'text') {
      placeText(drag.start);
      setTool('select');
      return;
    }
    if (drag.kind !== 'draw') return;

    setDraft(null);
    const drawn = rectFromPoints(drag.start, localPoint(event));
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
    addAnnotation(entry.id, { type: 'marker', rect: viewportToPdfRect(rectPx, view) });
    setTool('select');
  };

  const finishEditing = (annotation) => {
    setEditingAnnotationId(null);
    if (!annotation.text.trim()) deleteAnnotation(annotation.id);
    else selectAnnotation(annotation.id);
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
    } else if (event.key === 'Enter' && annotation.type === 'text') {
      event.preventDefault();
      setEditingAnnotationId(annotation.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      selectAnnotation(null);
      layerRef.current?.focus({ preventScroll: true });
    }
  };

  const handleLayerKeyDown = (event) => {
    if (event.key === 'Escape' && tool !== 'select') {
      event.preventDefault();
      setTool('select');
    }
  };

  const counts = { marker: 0, text: 0 };

  return (
    <div
      ref={layerRef}
      className={`annotation-layer${tool !== 'select' ? ' annotation-layer--placing' : ''}${
        tool === 'text' ? ' annotation-layer--text' : ''
      }`}
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
        {HINTS[tool] ?? HINTS.select}
      </span>

      {annotations.map((annotation) => {
        const rectPx = pdfToViewportRect(annotation.rect, view);
        const selected = annotation.id === selectedAnnotationId;
        const editing = annotation.id === editingAnnotationId;
        const isText = annotation.type === 'text';
        counts[annotation.type] = (counts[annotation.type] ?? 0) + 1;
        const label = isText
          ? `Text ${counts.text}${annotation.text ? `: ${annotation.text}` : ''}`
          : `Marker ${counts.marker}`;
        const shortLabel = isText ? `text ${counts.text}` : `marker ${counts.marker}`;
        return (
          <div
            key={annotation.id}
            data-annotation-id={annotation.id}
            className={`annotation annotation--${annotation.type}${
              selected ? ' annotation--selected' : ''
            }${editing ? ' annotation--editing' : ''}`}
            style={{
              left: `${rectPx.x}px`,
              top: `${rectPx.y}px`,
              width: `${rectPx.width}px`,
              height: `${rectPx.height}px`,
            }}
            role="button"
            tabIndex={editing ? -1 : 0}
            aria-label={label}
            aria-pressed={selected}
            onPointerDown={(event) => handleAnnotationPointerDown(event, annotation, rectPx)}
            onDoubleClick={() => {
              if (isText) setEditingAnnotationId(annotation.id);
            }}
            onFocus={(event) => {
              if (event.target === event.currentTarget && !selected && tool === 'select') {
                selectAnnotation(annotation.id);
              }
            }}
            onKeyDown={(event) => handleAnnotationKeyDown(event, annotation, rectPx)}
          >
            {isText && (
              <TextContent
                annotation={annotation}
                boxPx={rectPx}
                scale={scale}
                pageRotation={view.rotation}
                editing={editing}
                onChange={(text) => updateTextAnnotation(annotation.id, { text })}
                onDone={() => finishEditing(annotation)}
              />
            )}
            {selected && !editing && (
              <>
                {/* Text is sized by its font size, so only markers resize. */}
                {!isText &&
                  HANDLES.map((handle) => (
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
                  aria-label={`Delete ${shortLabel}`}
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
