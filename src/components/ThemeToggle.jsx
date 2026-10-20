import { useState } from 'react';
import { applyTheme, currentTheme, safeLocalStorage, storeTheme } from '../lib/theme.js';
import './ThemeToggle.css';

/**
 * Light / dark switch. Self-contained so it can move when the layout
 * does: it reads and sets <html data-theme> and remembers the pick.
 */
function ThemeToggle() {
  const [theme, setTheme] = useState(() => currentTheme());
  const next = theme === 'dark' ? 'light' : 'dark';

  const toggle = () => {
    applyTheme(next);
    storeTheme(next, safeLocalStorage());
    setTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}

export default ThemeToggle;
