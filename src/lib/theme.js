/**
 * Light / dark mode. The mode lives on <html data-theme> and switches the
 * token set in src/styles/tokens.css (which also sets color-scheme); no
 * component reads it except the toggle. The device preference decides
 * until the user picks one, and the pick is remembered in this browser.
 *
 * Storage can be blocked (private windows, site-data settings), so every
 * read and write is guarded: the app then follows the device and the
 * toggle still works for the session.
 */

export const THEMES = ['light', 'dark'];
export const STORAGE_KEY = 'docusync-theme';

/** The remembered choice, or null if none (or storage is unavailable). */
export function readStoredTheme(storage) {
  try {
    const value = (storage === undefined ? globalThis.localStorage : storage)?.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remember a choice. Returns false if it couldn't be stored. */
export function storeTheme(theme, storage) {
  try {
    (storage === undefined ? globalThis.localStorage : storage).setItem(STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

function darkQuery(win) {
  try {
    return win?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  } catch {
    return null;
  }
}

export function systemTheme(win = globalThis.window) {
  return darkQuery(win)?.matches ? 'dark' : 'light';
}

export function currentTheme(doc = globalThis.document) {
  const value = doc?.documentElement.dataset.theme;
  return THEMES.includes(value) ? value : 'light';
}

export function applyTheme(theme, doc = globalThis.document) {
  doc.documentElement.dataset.theme = theme;
}

/**
 * Set the starting mode, and follow the device while the user hasn't
 * picked one. Returns a cleanup function.
 */
export function initTheme({ win = globalThis.window, doc = globalThis.document, storage } = {}) {
  const store = storage ?? safeLocalStorage(win);
  applyTheme(readStoredTheme(store) ?? systemTheme(win), doc);

  const query = darkQuery(win);
  if (!query?.addEventListener) return () => {};
  const follow = (event) => {
    if (!readStoredTheme(store)) applyTheme(event.matches ? 'dark' : 'light', doc);
  };
  query.addEventListener('change', follow);
  return () => query.removeEventListener('change', follow);
}

/** window.localStorage, or null where even touching it throws. */
export function safeLocalStorage(win = globalThis.window) {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}
