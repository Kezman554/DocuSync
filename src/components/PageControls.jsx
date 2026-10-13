import { useRef } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { formatZoom, MIN_SCALE, MAX_SCALE } from '../lib/zoom.js';
import './PageControls.css';

function PageControls() {
  const {
    currentPage,
    numPages,
    selected,
    canDelete,
    scale,
    nextPage,
    prevPage,
    rotateLeft,
    rotateRight,
    requestDelete,
    tool,
    setTool,
    pendingImage,
    loadImageFile,
    zoomIn,
    zoomOut,
  } = useDocumentContext();
  const imageInputRef = useRef(null);
  const targetCount = Math.max(selected.size, 1);
  const targetLabel = targetCount > 1 ? `${targetCount} pages` : 'page';

  return (
    <div className="page-controls" role="toolbar" aria-label="Page and zoom controls">
      <div className="page-controls__group">
        <button
          type="button"
          className="page-controls__btn"
          onClick={prevPage}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        <span className="page-controls__label">
          Page {currentPage} of {numPages}
        </span>
        <button
          type="button"
          className="page-controls__btn"
          onClick={nextPage}
          disabled={currentPage >= numPages}
          aria-label="Next page"
        >
          ›
        </button>
      </div>

      <div className="page-controls__group">
        <button
          type="button"
          className="page-controls__btn"
          onClick={rotateLeft}
          aria-label={`Rotate ${targetLabel} left`}
          title={`Rotate ${targetLabel} left`}
        >
          ⟲
        </button>
        <button
          type="button"
          className="page-controls__btn"
          onClick={rotateRight}
          aria-label={`Rotate ${targetLabel} right`}
          title={`Rotate ${targetLabel} right`}
        >
          ⟳
        </button>
        <button
          type="button"
          className="page-controls__btn"
          onClick={requestDelete}
          disabled={!canDelete}
          aria-label={`Delete ${targetLabel}`}
          title={
            canDelete ? `Delete ${targetLabel}` : 'Can’t delete every page'
          }
        >
          🗑
        </button>
        {targetCount > 1 && (
          <span className="page-controls__label page-controls__label--count">
            {targetCount} pages
          </span>
        )}
      </div>

      <div className="page-controls__group">
        <button
          type="button"
          className={`page-controls__btn page-controls__btn--tool${
            tool === 'marker' ? ' page-controls__btn--active' : ''
          }`}
          onClick={() => setTool(tool === 'marker' ? 'select' : 'marker')}
          aria-pressed={tool === 'marker'}
          aria-label="Place marker"
          title="Place marker — click the page, or drag to draw (Esc cancels)"
        >
          ▭ Marker
        </button>
        <button
          type="button"
          className={`page-controls__btn page-controls__btn--tool${
            tool === 'text' ? ' page-controls__btn--active' : ''
          }`}
          onClick={() => setTool(tool === 'text' ? 'select' : 'text')}
          aria-pressed={tool === 'text'}
          aria-label="Add text"
          title="Add text — click where it should start, then type (Esc cancels)"
        >
          T Text
        </button>
        <button
          type="button"
          className={`page-controls__btn page-controls__btn--tool${
            tool === 'image' ? ' page-controls__btn--active' : ''
          }`}
          onClick={() =>
            tool === 'image' ? setTool('select') : imageInputRef.current?.click()
          }
          aria-pressed={tool === 'image'}
          aria-label="Add image"
          title={
            tool === 'image' && pendingImage
              ? `Place ${pendingImage.name} — click the page, or drag to size it (Esc cancels)`
              : 'Add a PNG or JPG image'
          }
        >
          🖼 Image
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          className="page-controls__file-input"
          aria-label="Choose image"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ''; // allow choosing the same file again
            loadImageFile(file);
          }}
        />
      </div>

      <div className="page-controls__group">
        <button
          type="button"
          className="page-controls__btn"
          onClick={zoomOut}
          disabled={scale <= MIN_SCALE}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="page-controls__label page-controls__label--zoom">
          {formatZoom(scale)}
        </span>
        <button
          type="button"
          className="page-controls__btn"
          onClick={zoomIn}
          disabled={scale >= MAX_SCALE}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}

export default PageControls;
