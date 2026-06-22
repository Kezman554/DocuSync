import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import './ThumbnailSidebar.css';

function ThumbnailSidebar({ open }) {
  const { hasDocument, document, currentPage, setCurrentPage } =
    useDocumentContext();

  // Page count is unknown until the PDF is parsed (later task). Until then we
  // show a single placeholder slot so the layout is demonstrable.
  const pageCount = document?.numPages ?? (hasDocument ? 1 : 0);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <aside
      className={`sidebar${open ? ' sidebar--open' : ''}`}
      aria-label="Page thumbnails"
    >
      {hasDocument ? (
        <ol className="sidebar__list">
          {pages.map((page) => (
            <li key={page}>
              <button
                type="button"
                className={`sidebar__thumb${
                  page === currentPage ? ' sidebar__thumb--active' : ''
                }`}
                onClick={() => setCurrentPage(page)}
                aria-current={page === currentPage ? 'page' : undefined}
              >
                <span className="sidebar__thumb-preview" aria-hidden="true" />
                <span className="sidebar__thumb-label">{page}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sidebar__empty">No document open</p>
      )}
    </aside>
  );
}

export default ThumbnailSidebar;
