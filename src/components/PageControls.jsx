import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { formatZoom, MIN_SCALE, MAX_SCALE } from '../lib/zoom.js';
import './PageControls.css';

function PageControls() {
  const {
    currentPage,
    numPages,
    scale,
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
  } = useDocumentContext();

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
