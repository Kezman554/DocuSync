import { useEffect, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import PageThumbnail from './PageThumbnail.jsx';
import { isRedacted } from '../lib/redaction.js';
import {
  LONG_PRESS_MS,
  autoScrollStep,
  dropIndexAt,
  isOutside,
  movedTooFar,
} from '../lib/touchReorder.js';
import './ThumbnailSidebar.css';

const DRAG_TYPE = 'application/x-docusync-page';

// Badge colours distinguishing source documents once more than one is loaded
// (--source-1 … --source-6 in src/styles/tokens.css).
const SOURCE_COLOURS = [1, 2, 3, 4, 5, 6].map((n) => `var(--source-${n})`);

function ThumbnailSidebar({ open, collapsed = false }) {
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
  } = useDocumentContext();

  // Callback ref → state so the scroll container can be passed as the
  // IntersectionObserver root once it's mounted.
  const [scrollEl, setScrollEl] = useState(null);
  const asideRef = useRef(null);
  const listRef = useRef(null);

  // Drag-reorder state: the ids being dragged, and the insertion index
  // (0..pages.length) where the drop indicator is currently drawn.
  const [dragIds, setDragIds] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  const endDrag = () => {
    setDragIds(null);
    setDropIndex(null);
  };

  /**
   * What a drag of `entry` moves. Dragging a selected page drags the whole
   * selection; dragging an unselected page selects and drags just that page.
   */
  const idsToDrag = (entry) => {
    if (selected.has(entry.id)) return pages.filter((p) => selected.has(p.id)).map((p) => p.id);
    selectPage(entry.id);
    return [entry.id];
  };

  const handleDragStart = (event, entry) => {
    // A touch long press is handled below; don't let a browser that does
    // turn it into an HTML5 drag run a second drag alongside.
    if (touchRef.current) {
      event.preventDefault();
      return;
    }
    const ids = idsToDrag(entry);
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

  // --- Touch: long press to pick up, drag, release to drop ----------------
  // Mobile browsers don't fire HTML5 drag events from touch. A quick swipe
  // stays a scroll; holding still for LONG_PRESS_MS lifts the thumbnail,
  // and only then is scrolling blocked (see the touchmove listener).
  //
  // touchRef: { pointerId, entry, start, last, timer, lifted, ids, frame }
  const touchRef = useRef(null);
  const [liftedId, setLiftedId] = useState(null);
  // A drop is followed by a click on the thumbnail; it mustn't reselect.
  const suppressClickRef = useRef(false);
  // Latest values for the auto-scroll loop, which outlives a render.
  const dropIndexRef = useRef(null);
  dropIndexRef.current = dropIndex;
  const movePagesRef = useRef(movePages);
  movePagesRef.current = movePages;

  const clearTouch = () => {
    const touch = touchRef.current;
    if (!touch) return;
    clearTimeout(touch.timer);
    cancelAnimationFrame(touch.frame);
    touchRef.current = null;
    setLiftedId(null);
    endDrag();
  };

  /** Point the drop indicator at where the finger is over the list. */
  const trackDrop = (y) => {
    const items = Array.from(listRef.current?.children ?? []);
    const next = dropIndexAt(
      y,
      items.map((item) => item.getBoundingClientRect())
    );
    if (next !== dropIndexRef.current) setDropIndex(next);
  };

  /** While lifted, scroll near the edges and keep the indicator under the finger. */
  const autoScroll = () => {
    const touch = touchRef.current;
    if (!touch?.lifted || !scrollEl) return;
    const step = autoScrollStep(touch.last.y, scrollEl.getBoundingClientRect());
    if (step) {
      scrollEl.scrollTop += step;
      trackDrop(touch.last.y);
    }
    touch.frame = requestAnimationFrame(autoScroll);
  };

  const lift = () => {
    const touch = touchRef.current;
    if (!touch) return;
    touch.lifted = true;
    touch.ids = idsToDrag(touch.entry);
    setDragIds(touch.ids);
    setLiftedId(touch.entry.id);
    trackDrop(touch.last.y);
    navigator.vibrate?.(30);
    touch.frame = requestAnimationFrame(autoScroll);
  };

  const handlePointerDown = (event, entry) => {
    if (event.pointerType !== 'touch' || touchRef.current) return; // mouse/pen: HTML5 drag
    const point = { x: event.clientX, y: event.clientY };
    touchRef.current = {
      pointerId: event.pointerId,
      entry,
      start: point,
      last: point,
      lifted: false,
      timer: setTimeout(lift, LONG_PRESS_MS),
    };
  };

  const handlePointerMove = (event) => {
    const touch = touchRef.current;
    if (!touch || event.pointerId !== touch.pointerId) return;
    touch.last = { x: event.clientX, y: event.clientY };
    if (!touch.lifted) {
      // Moved before the long press: it's a scroll — let the browser have it.
      if (movedTooFar(touch.start, touch.last)) clearTouch();
      return;
    }
    if (asideRef.current && isOutside(touch.last, asideRef.current.getBoundingClientRect())) {
      clearTouch(); // off the sidebar: cancel, nothing moves
      return;
    }
    trackDrop(touch.last.y);
  };

  const handlePointerUp = (event) => {
    const touch = touchRef.current;
    if (!touch || event.pointerId !== touch.pointerId) return;
    if (touch.lifted) {
      suppressClickRef.current = true;
      const index = dropIndexRef.current;
      if (index !== null) movePagesRef.current(touch.ids, index);
    }
    clearTouch();
  };

  // While a thumbnail is lifted, stop the finger scrolling the sidebar. It
  // needs a non-passive listener (React's are passive), and must be in
  // place before the first move or the browser starts a scroll and cancels
  // the pointer.
  useEffect(() => {
    if (!scrollEl) return undefined;
    const block = (event) => {
      if (touchRef.current?.lifted) event.preventDefault();
    };
    scrollEl.addEventListener('touchmove', block, { passive: false });
    return () => scrollEl.removeEventListener('touchmove', block);
  }, [scrollEl]);

  // Never leave a timer or animation frame running after unmount.
  useEffect(() => () => {
    clearTimeout(touchRef.current?.timer);
    cancelAnimationFrame(touchRef.current?.frame);
  }, []);

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
      ref={asideRef}
      className={`sidebar${open ? ' sidebar--open' : ''}${collapsed ? ' sidebar--collapsed' : ''}`}
      aria-label="Page thumbnails"
    >
      {hasDocument ? (
        <div className="sidebar__scroll" ref={setScrollEl}>
          <ol
            ref={listRef}
            className={`sidebar__list${liftedId ? ' sidebar__list--touch-dragging' : ''}`}
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
                  // Touch pointers are captured by the element first touched,
                  // so moves and the release come back here wherever the
                  // finger goes.
                  onPointerDown={(event) => handlePointerDown(event, entry)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={clearTouch}
                  onContextMenu={(event) => {
                    // A long press would also open the browser's menu.
                    if (touchRef.current) event.preventDefault();
                  }}
                >
                  <PageThumbnail
                    pdfDoc={sourcesById[entry.sourceId]?.pdfDoc}
                    source={sourceInfo?.[entry.sourceId]}
                    sourcePage={entry.sourcePage}
                    rotation={entry.rotation}
                    label={index + 1}
                    redacted={isRedacted(entry)}
                    active={index + 1 === currentPage}
                    selected={selected.has(entry.id)}
                    dragging={dragging?.has(entry.id) ?? false}
                    lifted={liftedId === entry.id}
                    onSelect={(event) => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      selectPage(entry.id, {
                        toggle: event.ctrlKey || event.metaKey,
                        range: event.shiftKey,
                      });
                    }}
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
            Drag (or touch and hold) to reorder · Alt+↑/↓ to move · Del to delete
          </p>
        </div>
      ) : (
        <p className="sidebar__empty">No document open</p>
      )}
    </aside>
  );
}

export default ThumbnailSidebar;
