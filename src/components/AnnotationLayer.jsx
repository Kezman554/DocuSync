import { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import {
  DEFAULT_MARKER_SIZE,
  clampRectToBounds,
  getAnnotations,
  moveRect,
  rectCenteredAt,
  rectFromPoints,
  resizeRect,
  resizeRectLocked,
} from '../lib/annotations.js';
import { defaultImageSize } from '../lib/imageInfo.js';
import { defaultStampSize, stampOrigin } from '../lib/stamps.js';
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
  scaleFontSize,
  textLayout,
} from '../lib/textLayout.js';
import './AnnotationLayer.css';

const HANDLES = ['nw', 'ne', 'sw', 'se'];
const STAMP_KIND_NAMES = { initials: 'Initials', signature: 'Signature' };

/**
 * Accessible name for an annotation. Stamps say what they are ("Signature
 * 1: My signature", "Cross 2"); others by type ("Text 1: Hello", "Image 1").
 * `counts` tallies per label key as annotations are rendered.
 */
function annotationLabel(annotation, counts) {
  const { stamp } = annotation;
  const bump = (key) => {
    counts[key] = (counts[key] ?? 0) + 1;
    return counts[key];
  };
  if (stamp?.kind === 'tick') return `${stamp.name} ${bump(`tick:${stamp.name}`)}`;
  if (stamp) {
    const kind = STAMP_KIND_NAMES[stamp.kind] ?? 'Stamp';
    return `${kind} ${bump(kind)}: ${stamp.name}`;
  }
  const name = { marker: 'Marker', text: 'Text', image: 'Image' }[annotation.type] ?? 'Annotation';
  const n = bump(name);
  return annotation.type === 'text' && annotation.text ? `${name} ${n}: ${annotation.text}` : `${name} ${n}`;
}
/** A press that moves less than this (px) is a click, not a drag-to-draw. */
const CLICK_SLOP = 4;

const HINTS = {
  marker: 'Click to place a marker, or drag to draw one. Escape cancels.',
  text: 'Click where the text should start, then type. Escape cancels.',
  image: 'Click to place the image, or drag to size it. Escape cancels.',
  stamp: 'Click to place the stamp; keep clicking to place more. Escape stops.',
  select:
    'Select an annotation to move it with the arrow keys or delete it. Press Enter to edit text.',
};

/**
 * Turn and centre content laid out in its own (unrotated) frame so it sits
 * in its on-screen bounds: by however much the page has been rotated since
 * the content was placed (upright at the time).
 */
function ownFrameStyle(annotation, boxPx, scale, pageRotation) {
  const own = ownSize(annotation.rect, annotation.rotate);
  const width = own.width * scale;
  const height = own.height * scale;
  const turn = normalizeQuarterTurn(pageRotation - annotation.rotate);
  return {
    turn,
    style: {
      left: `${(boxPx.width - width) / 2}px`,
      top: `${(boxPx.height - height) / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
      transform: turn ? `rotate(${turn}deg)` : undefined,
    },
  };
}

/** Image annotation: the picture in its own frame, turned with the page. */
function ImageContent({ annotation, boxPx, scale, pageRotation }) {
  const { turn, style } = ownFrameStyle(annotation, boxPx, scale, pageRotation);
  return (
    <div className="annotation__content" style={style} data-turn={turn}>
      <img
        className="annotation__image"
        src={annotation.image.url}
        alt=""
        draggable={false}
      />
    </div>
  );
}

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
  const { turn, style } = ownFrameStyle(annotation, boxPx, scale, pageRotation);

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
            fontStyle: font.style,
            fontWeight: font.weight,
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
              fontStyle={font.style}
              fontWeight={font.weight}
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
    updateAnnotation,
    updateAnnotationRect,
    updateTextAnnotation,
    deleteAnnotation,
    editingAnnotationId,
    setEditingAnnotationId,
    textStyle,
    pendingImage,
    pendingStamp,
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

  // Rect from the drag start towards `p`, locked to `ratio` (width / height).
  const lockedDraft = (start, p, ratio) => {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    let width = Math.abs(dx);
    let height = Math.abs(dy);
    if (width / ratio > height) height = width / ratio;
    else width = height * ratio;
    return clampRectToBounds(
      {
        x: dx < 0 ? start.x - width : start.x,
        y: dy < 0 ? start.y - height : start.y,
        width,
        height,
      },
      bounds
    );
  };

  const placeImage = (start, drawn) => {
    const { stamp, ...image } = pendingImage;
    // Default: signatures at a realistic signing width; other images 1px =
    // 1pt. Both shrunk to fit 40% of the page as displayed.
    const pageSize = { width: bounds.width / scale, height: bounds.height / scale };
    const size = stamp
      ? defaultStampSize({ kind: stamp.kind, width: image.width, height: image.height }, pageSize)
      : defaultImageSize(image, pageSize);
    const rectPx =
      drawn && drawn.width >= CLICK_SLOP
        ? drawn
        : rectCenteredAt(start, { width: size.width * scale, height: size.height * scale }, bounds);
    addAnnotation(entry.id, {
      type: 'image',
      rotate: view.rotation, // upright as the page is shown now
      rect: viewportToPdfRect(rectPx, view),
      image,
      ...(stamp && { stamp }),
    });
  };

  /** Place a text stamp (tick, initials) centred on `point`, upright as shown. */
  const placeStamp = (point) => {
    const { text, font, fontSize, color } = pendingStamp.content;
    const width = measureTextWidth(text, font, fontSize);
    const { height } = textLayout({ text, font, fontSize });
    const topLeftPx = clampRectToBounds(
      {
        x: point.x - (width * scale) / 2,
        y: point.y - (height * scale) / 2,
        width: width * scale,
        height: height * scale,
      },
      bounds
    );
    const rotate = view.rotation;
    addAnnotation(entry.id, {
      type: 'text',
      text,
      font,
      fontSize,
      color,
      rotate,
      rect: rectFromTopLeft(viewportToPdfPoint(topLeftPx, view), rotate, width, height),
      stamp: stampOrigin(pendingStamp),
    });
  };

  const handleLayerPointerDown = (event) => {
    const placing = {
      marker: 'draw',
      text: 'text',
      image: pendingImage ? 'image' : null,
      stamp: pendingStamp ? 'stamp' : null,
    }[tool];
    if (placing) {
      startGesture(event, { kind: placing });
      const p = dragRef.current?.start;
      if (p && (placing === 'draw' || placing === 'image')) {
        setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
      }
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
    startGesture(event, {
      kind: 'resize',
      id: annotation.id,
      rect: rectPx,
      handle,
      // Images and stamps scale proportionally; text stamps by font size.
      locked: annotation.type === 'image' || Boolean(annotation.stamp),
      fontSize: annotation.type === 'text' ? annotation.fontSize : null,
    });
  };

  /**
   * Resize a text stamp: scale its font size by how much the box grew,
   * within the font-size limits, keeping the dragged handle's opposite
   * corner fixed.
   */
  const resizeTextStamp = (drag, proposed) => {
    const { fontSize, factor } = scaleFontSize(drag.fontSize, proposed.width / drag.rect.width);
    const width = drag.rect.width * factor;
    const height = drag.rect.height * factor;
    const rect = {
      x: drag.handle.includes('e') ? drag.rect.x : drag.rect.x + drag.rect.width - width,
      y: drag.handle.includes('s') ? drag.rect.y : drag.rect.y + drag.rect.height - height,
      width,
      height,
    };
    updateAnnotation(drag.id, { fontSize, rect: viewportToPdfRect(rect, view) });
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = localPoint(event);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (drag.kind === 'move') commit(drag.id, moveRect(drag.rect, dx, dy, bounds));
    else if (drag.kind === 'resize') {
      const resize = drag.locked ? resizeRectLocked : resizeRect;
      const proposed = resize(drag.rect, drag.handle, dx, dy, bounds);
      if (drag.fontSize) resizeTextStamp(drag, proposed);
      else commit(drag.id, proposed);
    } else if (drag.kind === 'draw') setDraft(rectFromPoints(drag.start, p));
    else if (drag.kind === 'image') {
      setDraft(lockedDraft(drag.start, p, pendingImage.width / pendingImage.height));
    }
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
    if (drag.kind === 'stamp') {
      placeStamp(drag.start); // tool stays armed for the next one
      return;
    }
    if (drag.kind === 'image') {
      setDraft(null);
      const end = localPoint(event);
      placeImage(drag.start, lockedDraft(drag.start, end, pendingImage.width / pendingImage.height));
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
    } else if (event.key === 'Enter' && annotation.type === 'text' && !annotation.stamp) {
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

  const counts = {};

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
        const label = annotationLabel(annotation, counts);
        const shortLabel = label.split(':')[0].toLowerCase();
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
              // Stamps are fixed marks; only free text is edited in place.
              if (isText && !annotation.stamp) setEditingAnnotationId(annotation.id);
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
            {annotation.type === 'image' && (
              <ImageContent
                annotation={annotation}
                boxPx={rectPx}
                scale={scale}
                pageRotation={view.rotation}
              />
            )}
            {selected && !editing && (
              <>
                {/* Free text is sized by its font size; everything else,
                    including tick/initials stamps, resizes from the corners. */}
                {(!isText || annotation.stamp) &&
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
