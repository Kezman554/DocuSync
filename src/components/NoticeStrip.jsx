import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import './NoticeStrip.css';

/**
 * The header notice, as a strip across the top of the workspace directly
 * under the header (DESIGN.md › Layout). It pushes everything below it
 * down rather than covering anything. Errors keep the danger edge;
 * information is a neutral outlined note. One × dismisses it.
 */
function NoticeStrip() {
  const { notice, dismissNotice } = useDocumentContext();
  if (!notice?.length) return null;
  const hasError = notice.some((n) => n.kind === 'error');

  return (
    <div className="notice-strip" role={hasError ? 'alert' : 'status'}>
      <div className="notice-strip__items">
        {notice.map((n) => (
          <p key={n.text} className={`notice-strip__item notice-strip__item--${n.kind}`}>
            {n.text}
          </p>
        ))}
      </div>
      <button
        type="button"
        className="notice-strip__dismiss"
        onClick={dismissNotice}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export default NoticeStrip;
