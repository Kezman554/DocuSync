import { useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import PageThumbnail from './PageThumbnail.jsx';
import './ThumbnailSidebar.css';

function ThumbnailSidebar({ open }) {
  const { hasDocument, pdfDoc, pages, currentPage, selected, selectPage } =
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
            {pages.map((entry, index) => (
              <li key={entry.id}>
                <PageThumbnail
                  pdfDoc={pdfDoc}
                  sourcePage={entry.sourcePage}
                  rotation={entry.rotation}
                  label={index + 1}
                  active={index + 1 === currentPage}
                  selected={selected.has(entry.id)}
                  onSelect={(event) =>
                    selectPage(entry.id, {
                      toggle: event.ctrlKey || event.metaKey,
                      range: event.shiftKey,
                    })
                  }
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
