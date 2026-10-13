import { useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import PageThumbnail from './PageThumbnail.jsx';
import PageNumbersDialog from './PageNumbersDialog.jsx';
import './ThumbnailSidebar.css';

const DRAG_TYPE = 'application/x-docusync-page';

// Badge colours distinguishing source documents once more than one is loaded.
const SOURCE_COLOURS = ['#3a82f6', '#e5a50a', '#2ec27e', '#e66100', '#c061cb', '#f66151'];

function ThumbnailSidebar({ open }) {
  const {
    hasDocument,
    sources,
    sourcesById,
    pages,
    currentPage,
    selected,
    selectPage,
    movePages,
    nudgeSelected,
    requestDelete,
    numbering,
  } = useDocumentContext();
  const [numbersOpen, setNumbersOpen] = useState(false);

  // Callback ref → state so the scroll container can be passed as the
  // IntersectionObserver root once it's mounted.
  const [scrollEl, setScrollEl] = useState(null);

  // Drag-reorder state: the ids being dragged, and the insertion index
  // (0..pages.length) where the drop indicator is currently drawn.
  const [dragIds, setDragIds] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  const endDrag = () => {
    setDragIds(null);
    setDropIndex(null);
  };

  const handleDragStart = (event, entry) => {
    // Dragging a selected page drags the whole selection; dragging an
    // unselected page selects and drags just that page.
    let ids;
    if (selected.has(entry.id)) {
      ids = pages.filter((p) => selected.has(p.id)).map((p) => p.id);
    } else {
      selectPage(entry.id);
      ids = [entry.id];
    }
    setDragIds(ids);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox won't start a drag without data.
    event.dataTransfer.setData(DRAG_TYPE, ids.join(','));
  };

  const handleDragOver = (event, index) => {
    if (!dragIds) return; // ignore external drags (e.g. a PDF file)
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    // Upper half of a thumbnail → insert before it; lower half → after it.
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const next = after ? index + 1 : index;
    if (next !== dropIndex) setDropIndex(next);
  };

  const handleDrop = (event) => {
    if (!dragIds) return;
    event.preventDefault();
    event.stopPropagation();
    if (dropIndex !== null) movePages(dragIds, dropIndex);
    endDrag();
  };

  const handleKeyDown = (event) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      nudgeSelected(event.key === 'ArrowUp' ? -1 : 1);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      requestDelete();
    }
  };

  const dragging = dragIds ? new Set(dragIds) : null;

  // Only label sources when merging — a single document needs no badge.
  const sourceInfo =
    sources.length > 1
      ? Object.fromEntries(
          sources.map((src, i) => [
            src.id,
            {
              name: src.name,
              letter: String.fromCharCode(65 + (i % 26)),
              colour: SOURCE_COLOURS[i % SOURCE_COLOURS.length],
            },
          ])
        )
      : null;

  return (
    <aside
      className={`sidebar${open ? ' sidebar--open' : ''}`}
      aria-label="Page thumbnails"
    >
      {hasDocument ? (
        <div className="sidebar__scroll" ref={setScrollEl}>
          <ol
            className="sidebar__list"
            onKeyDown={handleKeyDown}
            // Drops in the gaps between items keep the last indicator position.
            onDragOver={(event) => {
              if (dragIds) event.preventDefault();
            }}
            onDrop={handleDrop}
            aria-describedby="sidebar-reorder-hint"
          >
            {pages.map((entry, index) => {
              const dropBefore = dropIndex === index;
              const dropAfter =
                index === pages.length - 1 && dropIndex === pages.length;
              return (
                <li
                  key={entry.id}
                  className={`sidebar__item${
                    dropBefore ? ' sidebar__item--drop-before' : ''
                  }${dropAfter ? ' sidebar__item--drop-after' : ''}`}
                  onDragOver={(event) => handleDragOver(event, index)}
                  onDrop={handleDrop}
                >
                  <PageThumbnail
                    pdfDoc={sourcesById[entry.sourceId]?.pdfDoc}
                    source={sourceInfo?.[entry.sourceId]}
                    sourcePage={entry.sourcePage}
                    rotation={entry.rotation}
                    label={index + 1}
                    active={index + 1 === currentPage}
                    selected={selected.has(entry.id)}
                    dragging={dragging?.has(entry.id) ?? false}
                    onSelect={(event) =>
                      selectPage(entry.id, {
                        toggle: event.ctrlKey || event.metaKey,
                        range: event.shiftKey,
                      })
                    }
                    draggable
                    onDragStart={(event) => handleDragStart(event, entry)}
                    onDragEnd={endDrag}
                    root={scrollEl}
                  />
                </li>
              );
            })}
          </ol>
          <p id="sidebar-reorder-hint" className="sidebar__hint">
            Drag to reorder · Alt+↑/↓ to move · Del to delete
          </p>
          <button
            type="button"
            className={`sidebar__action${numbering ? ' sidebar__action--on' : ''}`}
            onClick={() => setNumbersOpen(true)}
            aria-haspopup="dialog"
          >
            Page numbers…
            {numbering && <span className="sidebar__badge">On</span>}
          </button>
          {numbersOpen && <PageNumbersDialog onClose={() => setNumbersOpen(false)} />}
        </div>
      ) : (
        <p className="sidebar__empty">No document open</p>
      )}
    </aside>
  );
}

export default ThumbnailSidebar;
