import { useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import PageThumbnail from './PageThumbnail.jsx';
import './ThumbnailSidebar.css';

function ThumbnailSidebar({ open }) {
  const { hasDocument, pdfDoc, numPages, currentPage, goToPage } =
    useDocumentContext();

  // Callback ref → state so the scroll container can be passed as the
  // IntersectionObserver root once it's mounted.
  const [scrollEl, setScrollEl] = useState(null);

  return (
    <aside
      className={`sidebar${open ? ' sidebar--open' : ''}`}
      aria-label="Page thumbnails"
    >
      {hasDocument ? (
        <div className="sidebar__scroll" ref={setScrollEl}>
          <ol className="sidebar__list">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
              <li key={page}>
                <PageThumbnail
                  pdfDoc={pdfDoc}
                  pageNumber={page}
                  active={page === currentPage}
                  onSelect={() => goToPage(page)}
                  root={scrollEl}
                />
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="sidebar__empty">No document open</p>
      )}
    </aside>
  );
}

export default ThumbnailSidebar;
