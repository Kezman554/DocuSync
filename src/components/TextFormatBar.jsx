import { useId, useState } from 'react';
import { useDocumentContext } from '../hooks/DocumentContext.jsx';
import { findAnnotation } from '../lib/annotations.js';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, STANDARD_FONTS, clampFontSize } from '../lib/textLayout.js';
import './TextFormatBar.css';

const SIZE_PRESETS = [8, 10, 12, 14, 16, 18, 24, 32, 48, 72];

/**
 * Font, size and colour for text annotations. Shown while the Text tool is
 * active (styles the next box) or a text box is selected (restyles it).
 * Uses the PDF standard fonts so the export needs no embedded font files.
 */
function TextFormatBar() {
  const { tool, pages, selectedAnnotationId, textStyle, setTextStyle, updateTextAnnotation } =
    useDocumentContext();
  const ids = { font: useId(), size: useId(), color: useId(), sizes: useId() };
  // What's typed in the size box, so partial input ("", "2" on the way to
  // "24") isn't fought by the controlled value. Valid sizes apply instantly.
  const [sizeDraft, setSizeDraft] = useState(null);

  const selected = selectedAnnotationId ? findAnnotation(pages, selectedAnnotationId) : null;
  const target = selected?.annotation.type === 'text' ? selected.annotation : null;
  if (tool !== 'text' && !target) return null;

  const style = target
    ? { font: target.font, fontSize: target.fontSize, color: target.color }
    : textStyle;

  const apply = (patch) => {
    setTextStyle((prev) => ({ ...prev, ...patch }));
    if (target) updateTextAnnotation(target.id, patch);
  };

  return (
    <div className="text-format" role="toolbar" aria-label="Text formatting">
      <label className="text-format__label" htmlFor={ids.font}>
        Font
      </label>
      <select
        id={ids.font}
        className="text-format__control"
        value={style.font}
        onChange={(event) => apply({ font: event.target.value })}
      >
        {Object.entries(STANDARD_FONTS).map(([key, { label, css }]) => (
          <option key={key} value={key} style={{ fontFamily: css }}>
            {label}
          </option>
        ))}
      </select>

      <label className="text-format__label" htmlFor={ids.size}>
        Size
      </label>
      <input
        id={ids.size}
        className="text-format__control text-format__control--size"
        type="number"
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        step="1"
        list={ids.sizes}
        value={sizeDraft ?? style.fontSize}
        onChange={(event) => {
          const raw = event.target.value;
          setSizeDraft(raw);
          const n = Number(raw);
          if (raw !== '' && n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) {
            apply({ fontSize: clampFontSize(n) });
          }
        }}
        onBlur={() => setSizeDraft(null)}
      />
      <datalist id={ids.sizes}>
        {SIZE_PRESETS.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <label className="text-format__label" htmlFor={ids.color}>
        Colour
      </label>
      <input
        id={ids.color}
        className="text-format__control text-format__control--color"
        type="color"
        value={style.color}
        onChange={(event) => apply({ color: event.target.value })}
      />
    </div>
  );
}

export default TextFormatBar;
