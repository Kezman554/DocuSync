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
    zoomIn,
    zoomOut,
  } = useDocumentContext();
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
