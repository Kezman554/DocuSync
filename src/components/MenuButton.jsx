import { useEffect, useId, useRef, useState } from 'react';
import './MenuButton.css';

/**
 * A button that opens a menu (WAI-ARIA menu button pattern).
 *
 * Enter, Space or ↓ open it on the first item, ↑ on the last. In the menu,
 * ↑/↓ move (wrapping), Home/End jump, Enter/Space choose, Esc closes; both
 * return focus to the trigger. Tab or a click outside just closes it.
 *
 * items: [{ label, onSelect, disabled?, title? }]
 */
function MenuButton({
  label,
  ariaLabel,
  items,
  className = '',
  menuClassName = '',
  align = 'start',
  disabled = false,
  title,
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);
  const rootRef = useRef(null);
  // Which item to focus once the menu has rendered: 'first' | 'last' | null.
  const focusOnOpen = useRef(null);

  const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);

  const focusItem = (index) => itemRefs.current[index]?.focus();

  const openMenu = (where) => {
    focusOnOpen.current = where;
    setOpen(true);
  };

  const close = (returnFocus) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusItem(focusOnOpen.current === 'last' ? enabled[enabled.length - 1] : enabled[0]);
    focusOnOpen.current = null;
  });

  // A press anywhere outside closes the menu, leaving focus where it lands.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu('last');
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  };

  const onMenuKeyDown = (event) => {
    const current = enabled.indexOf(itemRefs.current.indexOf(document.activeElement));
    const move = (to) => {
      event.preventDefault();
      focusItem(enabled[(to + enabled.length) % enabled.length]);
    };
    if (event.key === 'ArrowDown') move(current + 1);
    else if (event.key === 'ArrowUp') move(current - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(enabled.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // don't also cancel a tool or close a dialog
      close(true);
    } else if (event.key === 'Tab') setOpen(false);
  };

  const choose = (item) => {
    close(true);
    item.onSelect();
  };

  return (
    <div className={`menu-button ${className}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="menu-button__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        // Enter and Space arrive as a click: open on the first item.
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          className={`menu-button__menu menu-button__menu--${align} ${menuClassName}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, i) => (
            <li key={item.label} role="none">
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="menu-button__item"
                disabled={item.disabled}
                title={item.title}
                onClick={() => choose(item)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MenuButton;
