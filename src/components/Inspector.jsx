import { useEffect, useId, useRef, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { PHONE_QUERY, useMediaQuery } from '../hooks/useMediaQuery.js';
import { findAnnotation } from '../lib/annotations.js';
import { sheetSummary } from '../lib/sheetSummary.js';
import { STANDARD_FONTS } from '../lib/textLayout.js';
import PageNav from './PageNav.jsx';
import TextFormatBar, { textFormatTarget } from './TextFormatBar.jsx';
import ExtractPagesDialog from './ExtractPagesDialog.jsx';
import PageNumbersDialog from './PageNumbersDialog.jsx';
import WatermarkDialog from './WatermarkDialog.jsx';
import ProtectDialog from './ProtectDialog.jsx';
import StampsPanel from './StampsPanel.jsx';
import './Inspector.css';

const KIND_NAMES = { marker: 'Highlight', image: 'Image', redaction: 'Redaction box', text: 'Text box' };

/** A titled inspector section. */
function Section({ title, id, children }) {
  const headingId = useId();
  return (
    <section id={id} className="inspector__section" aria-labelledby={headingId}>
      <h2 id={headingId} className="inspector__heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The right-hand panel (DESIGN.md › Layout). It follows what's selected, in
 * this order, each section only when it applies: the selected annotation
 * (text format and the missing-character warning), the selected pages
 * (or the current page), then the document. While the Stamps tool is
 * active the stamps library comes first, with the rest still below it; it
 * also keeps the inspector open with no document, to manage stamps.
 *
 * Under 640 px it's a bottom sheet: lowered, a handle, a one-line summary
 * of its top section and page navigation with zoom; raised (at most 50% of
 * the screen's height), the handle, summary and sections, scrolling inside
 * it. Tap the summary or drag the handle to switch.
 */
function Inspector({ stampsOpen = false }) {
  const {
    hasDocument,
    pages,
    tool,
    selected,
    targetIds,
    canDelete,
    rotateLeft,
    rotateRight,
    deleteAnnotation,
    requestDelete,
    numbering,
    watermark,
    currentPage,
    textStyle,
    textCheck,
    selectedAnnotationId: selectedId,
    editingAnnotationId,
  } = useDocumentContext();
  const [dialog, setDialog] = useState(null); // 'extract' | 'numbers' | 'watermark' | 'password'
  const close = () => setDialog(null);

  const phone = useMediaQuery(PHONE_QUERY);
  const [raised, setRaised] = useState(false);
  const sheetRef = useRef(null);
  const bodyId = useId();
  const drag = useRef(null); // { y, moved }

  // Opening Stamps raises the sheet on the library; arming a stamp lowers
  // it so the page is free to tap.
  useEffect(() => {
    if (stampsOpen) setRaised(true);
  }, [stampsOpen]);
  useEffect(() => {
    if (tool === 'stamp') setRaised(false);
  }, [tool]);

  const shown = hasDocument || stampsOpen;

  // The sheet's height, for the viewer's scroll padding (Viewer.css), so
  // the page can scroll clear of it.
  useEffect(() => {
    const el = sheetRef.current;
    const root = document.documentElement;
    if (!phone || !el) {
      root.style.removeProperty('--sheet-height');
      return undefined;
    }
    const update = () => root.style.setProperty('--sheet-height', `${el.offsetHeight}px`);
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--sheet-height');
    };
  }, [phone, shown]);

  // Raised: keep the selected (or edited) annotation in view above the sheet.
  // The sheet's new height goes to the viewer's scroll padding first, or the
  // scroll would aim at where the lowered sheet's top was.
  useEffect(() => {
    if (!phone || !raised) return;
    const frame = requestAnimationFrame(() => {
      const el = sheetRef.current;
      if (el) document.documentElement.style.setProperty('--sheet-height', `${el.offsetHeight}px`);
      document
        .querySelector('.annotation--editing, .annotation--selected')
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [phone, raised, selectedId, editingAnnotationId]);

  if (!shown) return null;

  const found = selectedId ? findAnnotation(pages, selectedId) : null;
  const textTarget = textFormatTarget(pages, selectedId);
  const annotation = found?.annotation;

  const count = Math.max(targetIds.size, 1);
  const targetLabel = count > 1 ? `${count} pages` : 'page';
  const pagesTitle =
    selected.size > 1
      ? `${selected.size} pages selected`
      : `Page ${pages.findIndex((p) => targetIds.has(p.id)) + 1 || currentPage}`;

  // The selected annotation: text format for a text box (or the Text tool's
  // next box), otherwise what it is.
  const annotationSection =
    textTarget || tool === 'text' ? (
      <Section title={textTarget ? 'Text box' : 'New text'}>
        <TextFormatBar />
      </Section>
    ) : annotation?.type === 'marker' ? (
      <Section title="Highlight">
        <p className="inspector__hint">
          Drag to move it, or its corners to resize. It’s exported as a see-through yellow
          over the page; the text under it stays text.
        </p>
        <button
          type="button"
          className="inspector__btn inspector__btn--danger"
          onClick={() => deleteAnnotation(annotation.id)}
        >
          <span aria-hidden="true">🗑</span> Delete highlight
        </button>
      </Section>
    ) : annotation ? (
      <Section title={annotation.stamp?.name ?? KIND_NAMES[annotation.type] ?? 'Annotation'}>
        <p className="inspector__hint">
          Drag to move it, or its corners to resize. Delete or the × removes it.
        </p>
      </Section>
    ) : null;

  const sections = (
    <>
    {stampsOpen && (
      <Section id="stamps-panel" title="Stamps">
        <StampsPanel />
      </Section>
    )}
    {hasDocument && (
      <>
        {annotationSection}

        <Section title={pagesTitle}>
          <div className="inspector__row">
            <button
              type="button"
              className="inspector__btn"
              onClick={rotateLeft}
              aria-label={`Rotate ${targetLabel} left`}
              title={`Rotate ${targetLabel} left`}
            >
              <span aria-hidden="true">⟲</span> Left
            </button>
            <button
              type="button"
              className="inspector__btn"
              onClick={rotateRight}
              aria-label={`Rotate ${targetLabel} right`}
              title={`Rotate ${targetLabel} right`}
            >
              <span aria-hidden="true">⟳</span> Right
            </button>
            <button
              type="button"
              className="inspector__btn"
              onClick={() => setDialog('extract')}
              aria-haspopup="dialog"
              title={`Save the ${targetLabel} as a new PDF`}
            >
              Extract…
            </button>
          </div>
          <button
            type="button"
            className="inspector__btn inspector__btn--danger"
            onClick={requestDelete}
            disabled={!canDelete}
            title={canDelete ? `Delete ${targetLabel}` : 'Can’t delete every page'}
          >
            <span aria-hidden="true">🗑</span> Delete {targetLabel}
          </button>
        </Section>

        <Section title="Document">
          <button
            type="button"
            className="inspector__setting"
            onClick={() => setDialog('numbers')}
            aria-haspopup="dialog"
          >
            Page numbers…
            <span className={`inspector__state${numbering ? ' inspector__state--on' : ''}`}>
              {numbering ? 'On' : 'Off'}
            </span>
          </button>
          <button
            type="button"
            className="inspector__setting"
            onClick={() => setDialog('watermark')}
            aria-haspopup="dialog"
          >
            Watermark…
            <span className={`inspector__state${watermark ? ' inspector__state--on' : ''}`}>
              {watermark ? 'On' : 'Off'}
            </span>
          </button>
          <button
            type="button"
            className="inspector__setting"
            onClick={() => setDialog('password')}
            aria-haspopup="dialog"
            title="Download the edited PDF encrypted with a password"
          >
            Password…
          </button>
        </Section>
      </>
    )}
    </>
  );

  const dialogs = (
    <>
    {dialog === 'extract' && <ExtractPagesDialog onClose={close} />}
    {dialog === 'numbers' && <PageNumbersDialog onClose={close} />}
    {dialog === 'watermark' && <WatermarkDialog onClose={close} />}
    {dialog === 'password' && <ProtectDialog onClose={close} />}
    </>
  );

  if (!phone) {
    return (
      <aside className="inspector" aria-label="Inspector">
        {sections}
        {dialogs}
      </aside>
    );
  }

  // The summary line names the top section.
  const font = (key) => STANDARD_FONTS[key]?.label ?? key;
  const summary = sheetSummary(
    stampsOpen
      ? { stamps: { hasDocument } }
      : textTarget
        ? {
            text: {
              label: 'Text box',
              font: font(textTarget.font),
              size: textTarget.fontSize,
              missing: textCheck?.unexportableChars(textTarget.text, textTarget.font).length ?? 0,
            },
          }
        : tool === 'text'
          ? { text: { label: 'New text', font: font(textStyle.font), size: textStyle.fontSize } }
          : annotation
            ? { annotation: { name: annotation.stamp?.name ?? KIND_NAMES[annotation.type] ?? 'Annotation' } }
            : { pages: { selected: selected.size, current: currentPage } }
  );

  const toggleLabel = raised ? 'Lower the inspector' : 'Raise the inspector';
  const onHandleDown = (event) => {
    drag.current = { y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onHandleUp = (event) => {
    const start = drag.current;
    if (!start) return;
    const dy = event.clientY - start.y;
    // A drag up raises, down lowers; a tap is left to the click.
    if (Math.abs(dy) > 24) {
      start.moved = true;
      setRaised(dy < 0);
    }
  };
  const onHandleClick = () => {
    if (drag.current?.moved) {
      drag.current = null;
      return;
    }
    drag.current = null;
    setRaised((r) => !r);
  };

  return (
    <aside
      ref={sheetRef}
      className={`inspector inspector--sheet${raised ? ' inspector--raised' : ''}`}
      aria-label="Inspector"
    >
      <div className="inspector__sheet-head">
        <button
          type="button"
          className="inspector__handle"
          aria-label={toggleLabel}
          aria-expanded={raised}
          aria-controls={bodyId}
          onPointerDown={onHandleDown}
          onPointerUp={onHandleUp}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onClick={onHandleClick}
        >
          <span className="inspector__grip" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="inspector__summary"
          aria-expanded={raised}
          aria-controls={bodyId}
          title={toggleLabel}
          onClick={() => setRaised((r) => !r)}
        >
          {summary}
        </button>
        {/* Raised, the sections need the room; navigation returns when lowered. */}
        {hasDocument && !raised && <PageNav className="inspector__nav" />}
      </div>
      <div id={bodyId} className="inspector__sheet-body" hidden={!raised}>
        {sections}
      </div>
      {dialogs}
    </aside>
  );
}

export default Inspector;
