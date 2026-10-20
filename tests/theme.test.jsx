import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  STORAGE_KEY,
  initTheme,
  initialTheme,
  readStoredTheme,
  storeTheme,
} from '../src/lib/theme.js';
import ThemeToggle from '../src/components/ThemeToggle.jsx';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
}

const blockedStorage = {
  getItem() {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem() {
    throw new DOMException('blocked', 'SecurityError');
  },
};

function fakeWindow({ dark = false, storage = memoryStorage() } = {}) {
  const listeners = new Set();
  const query = {
    matches: dark,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  };
  return {
    matchMedia: () => query,
    get localStorage() {
      if (storage === 'throws') throw new DOMException('blocked', 'SecurityError');
      return storage;
    },
    flip(toDark) {
      query.matches = toDark;
      listeners.forEach((fn) => fn({ matches: toDark }));
    },
  };
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // jsdom storage always works; guarded to match the app
  }
});

describe('theme storage', () => {
  it('reads only a valid remembered choice', () => {
    expect(readStoredTheme(memoryStorage({ [STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(readStoredTheme(memoryStorage({ [STORAGE_KEY]: 'sepia' }))).toBeNull();
    expect(readStoredTheme(memoryStorage())).toBeNull();
  });

  it('survives blocked or missing storage', () => {
    expect(readStoredTheme(blockedStorage)).toBeNull();
    expect(readStoredTheme(null)).toBeNull();
    expect(storeTheme('dark', blockedStorage)).toBe(false);
    expect(storeTheme('dark', null)).toBe(false);
  });
});

describe('initTheme', () => {
  it('follows the device when nothing is remembered', () => {
    initTheme({ win: fakeWindow({ dark: true }), doc: document });
    expect(document.documentElement.dataset.theme).toBe('dark');
    initTheme({ win: fakeWindow({ dark: false }), doc: document });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('prefers the remembered choice over the device', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: 'light' });
    initTheme({ win: fakeWindow({ dark: true, storage }), doc: document });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('tracks device changes only until the user picks', () => {
    const storage = memoryStorage();
    const win = fakeWindow({ dark: false, storage });
    const stop = initTheme({ win, doc: document });
    win.flip(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    storage.setItem(STORAGE_KEY, 'dark');
    win.flip(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
    stop();
  });

  it('still sets a mode when even touching localStorage throws', () => {
    initTheme({ win: fakeWindow({ dark: true, storage: 'throws' }), doc: document });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('ThemeToggle', () => {
  it('switches the mode and remembers it', async () => {
    document.documentElement.dataset.theme = 'light';
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('still switches when storage is blocked', async () => {
    document.documentElement.dataset.theme = 'light';
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    spy.mockRestore();
  });
});

describe('index.html pre-paint script', () => {
  const html = readFileSync('index.html', 'utf8') // vitest runs from the repo root;
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  /** Run the inline script with `win` as its global scope; return the mode it set. */
  function runInline(win) {
    const doc = { documentElement: { dataset: {} } };
    const scope = new Proxy(win, {
      has: () => true,
      get: (target, key) => (key === 'document' ? doc : key in target ? target[key] : undefined),
    });
    // eslint-disable-next-line no-new-func -- sloppy mode so `with` stands in for window
    new Function('scope', `with (scope) { ${inline[0]} }`)(scope);
    return doc.documentElement.dataset.theme;
  }

  function win({ stored, dark }) {
    const w = {};
    if (dark !== 'none') w.matchMedia = () => ({ matches: dark });
    Object.defineProperty(w, 'localStorage', {
      get() {
        if (stored === 'access-throws') throw new DOMException('blocked', 'SecurityError');
        if (stored === 'get-throws') return blockedStorage;
        return memoryStorage(stored == null ? {} : { [STORAGE_KEY]: stored });
      },
    });
    return w;
  }

  it('is the only classic inline script', () => {
    expect(inline).toHaveLength(1);
  });

  const storedCases = ['light', 'dark', 'sepia', null, 'get-throws', 'access-throws'];
  const deviceCases = [true, false, 'none'];
  for (const stored of storedCases) {
    for (const dark of deviceCases) {
      it(`agrees with initialTheme(): stored ${stored}, device dark ${dark}`, () => {
        expect(runInline(win({ stored, dark }))).toBe(initialTheme(win({ stored, dark })));
      });
    }
  }
});
