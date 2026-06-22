import { useEffect, useRef, useState } from 'react';

/**
 * Returns [ref, inView]. Attach `ref` to an element; `inView` flips to true
 * once the element intersects the given root (defaults to the viewport).
 *
 * Designed for lazy rendering: once in view it latches true and the observer
 * disconnects, so the element is never re-hidden. Falls back to eager (true)
 * where IntersectionObserver is unavailable (e.g. jsdom in tests).
 */
export function useInView({ root = null, rootMargin = '0px', threshold = 0 } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return undefined;

    const el = ref.current;
    if (!el) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { root, rootMargin, threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [root, rootMargin, threshold, inView]);

  return [ref, inView];
}
