import { useEffect, useState } from 'react';

/** The phone layout (DESIGN.md › Layout, Phone). Keep in step with the CSS. */
export const PHONE_QUERY = '(max-width: 639px)';

function matches(query) {
  try {
    return window.matchMedia?.(query).matches ?? false;
  } catch {
    return false;
  }
}

/** Whether a media query matches now, updating as it changes. */
export function useMediaQuery(query) {
  const [match, setMatch] = useState(() => matches(query));
  useEffect(() => {
    let list;
    try {
      list = window.matchMedia?.(query);
    } catch {
      list = null;
    }
    if (!list?.addEventListener) return undefined;
    const update = () => setMatch(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return match;
}
