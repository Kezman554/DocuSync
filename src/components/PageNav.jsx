import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { formatZoom, MIN_SCALE, MAX_SCALE } from '../lib/zoom.js';
import './ToolRow.css';

/**
 * Page navigation and zoom: at the right end of the tool row, or in the
 * phone bottom sheet (DESIGN.md › Layout).
 */
function PageNav({ className = '' }) {
  const { currentPage, numPages, scale, nextPage, prevPage, zoomIn, zoomOut } =
    useDocumentContext();

  return (
    <div className={`tool-row__group tool-row__group--nav ${className}`}>
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
  );
}

export default PageNav;
