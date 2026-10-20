import { useRef } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { formatZoom, MIN_SCALE, MAX_SCALE } from '../lib/zoom.js';
import './ToolRow.css';

/**
 * The one tool row above the page (DESIGN.md › Layout): the tools on the
 * left, page navigation and zoom at the right end. Nothing floats over the
 * page; page actions (rotate, delete) live in the inspector. With no
 * document open only Stamps works, so the library can be managed first.
 */
function ToolRow({ stampsOpen = false, onToggleStamps }) {
  const {
    hasDocument,
    currentPage,
    numPages,
    scale,
    nextPage,
    prevPage,
    tool,
    setTool,
    pendingImage,
    loadImageFile,
    zoomIn,
    zoomOut,
  } = useDocumentContext();
  const imageInputRef = useRef(null);

  const toolClass = (on) => `tool-row__btn tool-row__btn--tool${on ? ' tool-row__btn--active' : ''}`;

  return (
    <div className="tool-row" role="toolbar" aria-label="Tools">
      <div className="tool-row__group tool-row__group--tools">
        <button
          type="button"
          className={toolClass(tool === 'marker')}
          onClick={() => setTool(tool === 'marker' ? 'select' : 'marker')}
          aria-pressed={tool === 'marker'}
          disabled={!hasDocument}
          aria-label="Place marker"
          title="Place marker — click the page, or drag to draw (Esc cancels)"
        >
          <span aria-hidden="true">▭</span>
          <span className="tool-row__text">Marker</span>
        </button>
        <button
          type="button"
          className={toolClass(tool === 'text')}
          onClick={() => setTool(tool === 'text' ? 'select' : 'text')}
          aria-pressed={tool === 'text'}
          disabled={!hasDocument}
          aria-label="Add text"
          title="Add text — click where it should start, then type (Esc cancels)"
        >
          <span aria-hidden="true">T</span>
          <span className="tool-row__text">Text</span>
        </button>
        <button
          type="button"
          className={toolClass(tool === 'image')}
          onClick={() =>
            tool === 'image' ? setTool('select') : imageInputRef.current?.click()
          }
          aria-pressed={tool === 'image'}
          disabled={!hasDocument}
          aria-label="Add image"
          title={
            tool === 'image' && pendingImage
              ? `Place ${pendingImage.name} — click the page, or drag to size it (Esc cancels)`
              : 'Add a PNG or JPG image'
          }
        >
          <span aria-hidden="true">🖼</span>
          <span className="tool-row__text">Image</span>
        </button>
        <button
          type="button"
          className={toolClass(tool === 'redact')}
          onClick={() => setTool(tool === 'redact' ? 'select' : 'redact')}
          aria-pressed={tool === 'redact'}
          disabled={!hasDocument}
          aria-label="Redact"
          title="Redact — drag boxes over content to remove it on export (Esc stops)"
        >
          <span aria-hidden="true">▨</span>
          <span className="tool-row__text">Redact</span>
        </button>
        <button
          type="button"
          className={toolClass(stampsOpen)}
          onClick={onToggleStamps}
          aria-expanded={stampsOpen}
          aria-controls="stamps-panel"
          title="Stamps library: ticks, initials and signatures"
        >
          <span aria-hidden="true">✔</span>
          <span className="tool-row__text">Stamps</span>
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          className="tool-row__file-input"
          aria-label="Choose image"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ''; // allow choosing the same file again
            loadImageFile(file);
          }}
        />
      </div>

      {hasDocument && (
        <div className="tool-row__group tool-row__group--nav">
          <button
            type="button"
            className="tool-row__btn tool-row__btn--icon"
            onClick={prevPage}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="tool-row__label">
            Page {currentPage} of {numPages}
          </span>
          <button
            type="button"
            className="tool-row__btn tool-row__btn--icon"
            onClick={nextPage}
            disabled={currentPage >= numPages}
            aria-label="Next page"
          >
            ›
          </button>
          <span className="tool-row__sep" aria-hidden="true" />
          <button
            type="button"
            className="tool-row__btn tool-row__btn--icon"
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="tool-row__label tool-row__label--zoom">{formatZoom(scale)}</span>
          <button
            type="button"
            className="tool-row__btn tool-row__btn--icon"
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

export default ToolRow;
