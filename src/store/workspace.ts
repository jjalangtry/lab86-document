import { useCallback, useEffect, useRef } from 'react';
import type { SavedTabs } from './tabs';

// Per-vault state. It lives in <vault>/.document/workspace.json so it travels with the vault.
export type Workspace = {
  tabs: SavedTabs | null;
  expanded: string[];
  bookmarks: string[];
  recent: string[];
  lastOpen: string | null;
  left: boolean;
  right: boolean;
  leftWidth: number;
  leftTab: 'files' | 'search' | 'bookmarks';
  rightTab: 'backlinks' | 'outgoing' | 'tags' | 'outline' | 'format';
  canvasViews: Record<string, { x: number; y: number; zoom: number }>;
};
export const DEFAULT_WORKSPACE: Workspace = { tabs: null, expanded: [], bookmarks: [], recent: [], lastOpen: null, left: true, right: false, leftWidth: 260, leftTab: 'files', rightTab: 'outline', canvasViews: {} };
const STATE_NAME = 'workspace';
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function sanitize(raw: unknown): Workspace {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<Workspace>;
  const tabs = saved.tabs && Array.isArray(saved.tabs.paths) ? { paths: saved.tabs.paths.map(p => typeof p === 'string' ? p : null), active: Number.isInteger(saved.tabs.active) ? saved.tabs.active : 0 } : null;
  return {
    tabs,
    expanded: strings(saved.expanded),
    bookmarks: strings(saved.bookmarks),
    recent: strings(saved.recent).slice(0, 30),
    lastOpen: typeof saved.lastOpen === 'string' ? saved.lastOpen : null,
    left: saved.left ?? true,
    right: saved.right ?? false,
    leftWidth: Math.min(480, Math.max(200, Number(saved.leftWidth) || 260)),
    leftTab: ['files', 'search', 'bookmarks'].includes(saved.leftTab as string) ? saved.leftTab as Workspace['leftTab'] : 'files',
    rightTab: ['backlinks', 'outgoing', 'tags', 'outline', 'format'].includes(saved.rightTab as string) ? saved.rightTab as Workspace['rightTab'] : 'outline',
    canvasViews: saved.canvasViews && typeof saved.canvasViews === 'object' ? saved.canvasViews : {},
  };
}

// Older versions kept this state in localStorage keyed by vault path. It is read once as a fallback.
function legacy(vaultPath: string): Partial<Workspace> {
  const read = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value) as T; } catch { return fallback; } };
  return {
    tabs: read<SavedTabs | null>(`document.tabs:${vaultPath}`, null),
    expanded: read<string[]>(`document.expanded:${vaultPath}`, []),
    bookmarks: read<string[]>(`document.bookmarks:${vaultPath}`, []),
    recent: read<string[]>(`document.recent:${vaultPath}`, []),
    lastOpen: localStorage.getItem(`document.lastOpen:${vaultPath}`),
    left: localStorage.getItem('document.left') !== '0',
    right: localStorage.getItem('document.right') === '1',
    leftWidth: Number(localStorage.getItem('document.leftWidth')) || 260,
  };
}

export function useWorkspaceStore() {
  const state = useRef<Workspace>({ ...DEFAULT_WORKSPACE });
  const vault = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async (vaultPath: string): Promise<Workspace> => {
    vault.current = vaultPath;
    const saved = await window.vault.readState(STATE_NAME).catch(() => null);
    state.current = sanitize(saved ?? legacy(vaultPath));
    return state.current;
  }, []);
  const flushNow = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!vault.current) return;
    await window.vault.writeState(STATE_NAME, state.current).catch(error => void window.vault.log('warn', `workspace save failed: ${error instanceof Error ? error.message : String(error)}`));
  }, []);
  const update = useCallback((patch: Partial<Workspace>) => {
    state.current = { ...state.current, ...patch };
    if (!vault.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushNow(); }, 500);
  }, [flushNow]);
  const unload = useCallback(async () => { await flushNow(); vault.current = null; state.current = { ...DEFAULT_WORKSPACE }; }, [flushNow]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { state, load, update, flush: flushNow, unload };
}
