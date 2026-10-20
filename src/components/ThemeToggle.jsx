import { useEffect, useState } from 'react';
import { applyTheme, currentTheme, safeLocalStorage, storeTheme } from '../lib/theme.js';
import './ThemeToggle.css';

/**
 * The mode and a way to switch it, remembered in this browser. Follows
 * <html data-theme> so every user stays in step, including when the device
 * preference changes it.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => currentTheme());
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const next = theme === 'dark' ? 'light' : 'dark';
  const toggle = () => {
    applyTheme(next);
    storeTheme(next, safeLocalStorage());
    setTheme(next);
  };
  return { theme, next, toggle };
}

/**
 * Light / dark switch. Self-contained so it can move when the layout
 * does: it reads and sets <html data-theme> and remembers the pick.
 */
function ThemeToggle() {
  const { theme, next, toggle } = useTheme();
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
