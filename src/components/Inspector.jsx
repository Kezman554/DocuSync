import { useId, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { findAnnotation } from '../lib/annotations.js';
import TextFormatBar, { textFormatTarget } from './TextFormatBar.jsx';
import ExtractPagesDialog from './ExtractPagesDialog.jsx';
import PageNumbersDialog from './PageNumbersDialog.jsx';
import WatermarkDialog from './WatermarkDialog.jsx';
import ProtectDialog from './ProtectDialog.jsx';
import './Inspector.css';

const KIND_NAMES = { marker: 'Marker', image: 'Image', redaction: 'Redaction box', text: 'Text box' };

/** A titled inspector section. */
function Section({ title, children }) {
  const id = useId();
  return (
    <section className="inspector__section" aria-labelledby={id}>
      <h2 id={id} className="inspector__heading">
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
 * (or the current page), then the document. `children` (the stamps
 * panel) goes first, and keeps the column open with no document.
 */
function Inspector({ stampsOpen = false, children }) {
  const {
    hasDocument,
    pages,
    tool,
    selectedAnnotationId,
    selected,
    targetIds,
    canDelete,
    rotateLeft,
    rotateRight,
    requestDelete,
    numbering,
    watermark,
    currentPage,
  } = useDocumentContext();
  const [dialog, setDialog] = useState(null); // 'extract' | 'numbers' | 'watermark' | 'password'
  const close = () => setDialog(null);

  if (!hasDocument && !stampsOpen) return null;

  const found = selectedAnnotationId ? findAnnotation(pages, selectedAnnotationId) : null;
  const textTarget = textFormatTarget(pages, selectedAnnotationId);
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
    ) : annotation ? (
      <Section title={annotation.stamp?.name ?? KIND_NAMES[annotation.type] ?? 'Annotation'}>
        <p className="inspector__hint">
          Drag to move it, or its corners to resize. Delete or the × removes it.
        </p>
      </Section>
    ) : null;

  return (
    <aside className="inspector" aria-label="Inspector">
      {children}
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

      {dialog === 'extract' && <ExtractPagesDialog onClose={close} />}
      {dialog === 'numbers' && <PageNumbersDialog onClose={close} />}
      {dialog === 'watermark' && <WatermarkDialog onClose={close} />}
      {dialog === 'password' && <ProtectDialog onClose={close} />}
    </aside>
  );
}

export default Inspector;
