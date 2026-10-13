import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDocumentContext } from './DocumentContext.jsx';
import {
  BUILT_IN_STAMPS,
  createImageStamp,
  createInitialsStamp,
} from '../lib/stamps.js';
import { createStampStore } from '../lib/stampStore.js';

/**
 * The stamps library: built-in presets plus the user's stamps, which are
 * persisted in IndexedDB (lib/stampStore.js) so they survive reloads.
 * Selecting a stamp arms it for placement on the open document.
 *
 * If IndexedDB is unavailable (some private-browsing modes) stamps still
 * work for the session, held in memory, and `persistent` is false.
 */
const StampsContext = createContext(null);

let memoryIds = 0;

export function StampsProvider({ children }) {
  const { hasDocument, armStamp, tool, pendingImage, pendingStamp } = useDocumentContext();
  const storeRef = useRef(null);
  const [saved, setSaved] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready
  const [persistent, setPersistent] = useState(true);
  const [error, setError] = useState(null);
  const [activeStampId, setActiveStampId] = useState(null);
  // Preview object URLs for image stamps, keyed by stamp id.
  const [previewUrls, setPreviewUrls] = useState({});

  useEffect(() => {
    let cancelled = false;
    const store = createStampStore();
    storeRef.current = store;
    store
      .list()
      .then((list) => {
        if (!cancelled) setSaved(list);
      })
      .catch(() => {
        if (!cancelled) setPersistent(false);
      })
      .finally(() => {
        if (!cancelled) setStatus('ready');
      });
    return () => {
      cancelled = true;
      store.close();
    };
  }, []);

  // Keep a preview URL for every image stamp; revoke ones no longer needed.
  // (Done in the effect body, not a state updater, so it runs exactly once.)
  const urlsRef = useRef({});
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const prev = urlsRef.current;
    const next = {};
    for (const stamp of saved) {
      if (stamp.content.type !== 'image') continue;
      next[stamp.id] =
        prev[stamp.id] ??
        URL.createObjectURL(new Blob([stamp.content.bytes], { type: stamp.content.mime }));
    }
    for (const [id, url] of Object.entries(prev)) {
      if (!(id in next)) URL.revokeObjectURL(url);
    }
    urlsRef.current = next;
    setPreviewUrls(next);
  }, [saved]);
  useEffect(
    () => () => Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL?.(url)),
    []
  );

  const stamps = useMemo(() => [...BUILT_IN_STAMPS, ...saved], [saved]);

  /** Save to IndexedDB, or keep in memory if storage isn't available. */
  const persist = useCallback(
    async (stamp) => {
      setError(null);
      if (persistent) {
        try {
          const record = await storeRef.current.add(stamp);
          setSaved((prev) => [...prev, record]);
          return record;
        } catch {
          setPersistent(false);
          setError('Stamps can’t be saved in this browser, so this one lasts until you reload.');
        }
      }
      const now = Date.now();
      const record = { ...stamp, id: `mem-${(memoryIds += 1)}`, createdAt: now, updatedAt: now };
      setSaved((prev) => [...prev, record]);
      return record;
    },
    [persistent]
  );

  const addInitials = useCallback(
    (initials, presetId, color) => persist(createInitialsStamp(initials, presetId, color)),
    [persist]
  );

  /** Save a PNG/JPG file as an image stamp (e.g. a signature). */
  const addImageStamp = useCallback(
    async (file, { kind = 'signature' } = {}) => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const name = file.name.replace(/\.(png|jpe?g)$/i, '');
        return await persist(createImageStamp(bytes, { name, kind }));
      } catch (err) {
        setError(`“${file.name}” couldn’t be added: ${err.message}.`);
        return null;
      }
    },
    [persist]
  );

  const renameStamp = useCallback(
    async (id, name) => {
      setError(null);
      try {
        const record =
          persistent && !id.startsWith('mem-')
            ? await storeRef.current.rename(id, name)
            : { ...saved.find((s) => s.id === id), name: name.trim() || 'Stamp' };
        setSaved((prev) => prev.map((s) => (s.id === id ? record : s)));
      } catch (err) {
        setError(`Couldn’t rename the stamp: ${err.message}.`);
      }
    },
    [persistent, saved]
  );

  const deleteStamp = useCallback(
    async (id) => {
      setError(null);
      try {
        if (persistent && !id.startsWith('mem-')) await storeRef.current.remove(id);
        setSaved((prev) => prev.filter((s) => s.id !== id));
        setActiveStampId((current) => (current === id ? null : current));
      } catch (err) {
        setError(`Couldn’t delete the stamp: ${err.message}.`);
      }
    },
    [persistent]
  );

  /** Choose a stamp; with a document open it's armed for placement. */
  const selectStamp = useCallback(
    (id) => {
      const stamp = stamps.find((s) => s.id === id);
      if (!stamp) return;
      setActiveStampId(id);
      if (hasDocument) armStamp(stamp);
    },
    [stamps, hasDocument, armStamp]
  );

  // The active stamp is "armed" while its placement tool is still waiting.
  const armedStampId =
    (tool === 'stamp' && pendingStamp?.id) ||
    (tool === 'image' && pendingImage?.id?.startsWith('stamp-') && pendingImage.id.slice(6)) ||
    null;

  const value = useMemo(
    () => ({
      stamps,
      status,
      persistent,
      error,
      previewUrls,
      activeStampId,
      armedStampId,
      selectStamp,
      addInitials,
      addImageStamp,
      renameStamp,
      deleteStamp,
      dismissError: () => setError(null),
    }),
    [
      stamps,
      status,
      persistent,
      error,
      previewUrls,
      activeStampId,
      armedStampId,
      selectStamp,
      addInitials,
      addImageStamp,
      renameStamp,
      deleteStamp,
    ]
  );

  return <StampsContext.Provider value={value}>{children}</StampsContext.Provider>;
}

export function useStamps() {
  const ctx = useContext(StampsContext);
  if (ctx === null) throw new Error('useStamps must be used within a StampsProvider');
  return ctx;
}
