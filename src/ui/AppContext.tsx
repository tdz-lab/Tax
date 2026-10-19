import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/schema';
import type { AppSettings } from '../domain/types';
import { currentFY } from '../lib/dates';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../services/settings';
import { ValidationError } from '../services/ledger';

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
export interface Toast {
  id: number;
  message: string;
  kind?: 'info' | 'bad';
  undo?: () => void | Promise<void>;
}

interface Ctx {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  fy: number;
  setFy: (fy: number) => void;
  saveState: SaveState;
  saveError: string | null;
  /** Run a persistence operation with save-status tracking and error reporting. */
  run: <T>(fn: () => Promise<T>, opts?: { success?: string; undo?: () => Promise<void> }) => Promise<T | undefined>;
  toast: (message: string, opts?: { kind?: 'info' | 'bad'; undo?: () => void | Promise<void> }) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  online: boolean;
  revision: number;
  reportSave: (state: SaveState, error?: string | null) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const seq = useRef(0);
  const revision = useLiveQuery(async () => ((await getDb().meta.get('revision'))?.value as number) ?? 0, [], 0);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, opts: { kind?: 'info' | 'bad'; undo?: () => void | Promise<void> } = {}) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, message, ...opts }]);
      setTimeout(() => dismiss(id), opts.undo ? 9000 : opts.kind === 'bad' ? 9000 : 4000);
    },
    [dismiss]
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { success?: string; undo?: () => Promise<void> } = {}) => {
      setSaveState('saving');
      try {
        const r = await fn();
        setSaveState('saved');
        setSaveError(null);
        if (opts.success) toast(opts.success, { undo: opts.undo });
        return r;
      } catch (e) {
        const msg = e instanceof ValidationError ? e.errors.join(' ') : (e as Error).message || String(e);
        setSaveState(e instanceof ValidationError ? 'idle' : 'failed');
        setSaveError(msg);
        toast(e instanceof ValidationError ? `Not saved: ${msg}` : `Save failed: ${msg}`, { kind: 'bad' });
        return undefined;
      }
    },
    [toast]
  );

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    const next = await saveSettings(patch);
    setSettings(next);
  }, []);

  const fy = settings.selectedFY ?? currentFY(new Date(), settings.taxTimeZone);
  const setFy = useCallback((v: number) => void updateSettings({ selectedFY: v }), [updateSettings]);

  const reportSave = useCallback((state: SaveState, error: string | null = null) => {
    setSaveState(state);
    setSaveError(error);
  }, []);
  const value = useMemo(
    () => ({ settings, updateSettings, fy, setFy, saveState, saveError, run, toast, toasts, dismiss, online, revision: revision ?? 0, reportSave }),
    [settings, updateSettings, fy, setFy, saveState, saveError, run, toast, toasts, dismiss, online, revision, reportSave]
  );
  if (!loaded) return <div className="empty">Loading local database…</div>;
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** Session-scoped UI state (filters, tabs) preserved while navigating. */
export function useSessionState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(`ui:${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: T | ((p: T) => T)) => {
      setV((prev) => {
        const next = typeof nv === 'function' ? (nv as (p: T) => T)(prev) : nv;
        try {
          sessionStorage.setItem(`ui:${key}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [key]
  );
  return [v, set];
}
