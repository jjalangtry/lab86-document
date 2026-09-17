import { useCallback, useRef, useState } from 'react';
import { noteName } from '../markdown';

// Open tabs. Each tab has its own back and forward history.
export type Tab = { id: number; path: string | null; history: string[]; index: number };
export const GRAPH = 'graph:';
export type TabKind = 'empty' | 'graph' | 'canvas' | 'note';
export const tabKind = (path: string | null): TabKind => path === null ? 'empty' : path === GRAPH ? 'graph' : path.endsWith('.canvas') ? 'canvas' : 'note';
export const tabTitle = (path: string | null) => path === null ? 'New tab' : path === GRAPH ? 'Graph view' : noteName(path).replace(/\.canvas$/i, '');
let nextTabId = 1;
export const blankTab = (): Tab => ({ id: nextTabId++, path: null, history: [], index: -1 });
export type SavedTabs = { paths: (string | null)[]; active: number };

type Options = {
  // Called before the active tab changes so pending edits are written.
  beforeSwitch: () => Promise<void>;
  // Loads the content for a path and returns a function that applies it to the view.
  // The tab state and the content are then set in one synchronous step, so the editor
  // never sees a new path with old text.
  show: (path: string | null) => Promise<() => void>;
  onError: (error: unknown) => void;
};

export function useTabs({ beforeSwitch, show, onError }: Options) {
  const [tabs, setTabs] = useState<Tab[]>(() => [blankTab()]);
  const [activeTab, setActiveTab] = useState<number>(() => tabs[0].id);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const activeRef = useRef(activeTab); activeRef.current = activeTab;
  const current = tabs.find(t => t.id === activeTab) ?? tabs[0];

  const insertAfterActive = useCallback((tab: Tab) => {
    setTabs(list => { const at = list.findIndex(t => t.id === activeRef.current); return [...list.slice(0, at + 1), tab, ...list.slice(at + 1)]; });
    setActiveTab(tab.id);
  }, []);
  // Opens a path in the active tab, or in a new tab. `push: false` replaces without a history entry.
  const open = useCallback(async (path: string, options: { push?: boolean; newTab?: boolean } = {}) => {
    try {
      await beforeSwitch();
      const apply = await show(path);
      if (options.newTab) { insertAfterActive({ ...blankTab(), path, history: [path], index: 0 }); apply(); return; }
      const id = activeRef.current;
      setTabs(list => list.map(t => {
        if (t.id !== id) return t;
        if (options.push === false) return { ...t, path };
        const history = [...t.history.slice(0, t.index + 1), path].slice(-100);
        return { ...t, path, history, index: history.length - 1 };
      }));
      apply();
    } catch (error) { onError(error); }
  }, [beforeSwitch, insertAfterActive, onError, show]);
  const select = useCallback(async (id: number) => {
    if (id === activeRef.current) return;
    const tab = tabsRef.current.find(t => t.id === id);
    if (!tab) return;
    try { await beforeSwitch(); const apply = await show(tab.path); setActiveTab(id); apply(); } catch (error) { onError(error); }
  }, [beforeSwitch, onError, show]);
  const close = useCallback(async (id: number) => {
    const list = tabsRef.current;
    const at = list.findIndex(t => t.id === id);
    if (at < 0) return;
    try {
      if (list.length === 1) { const apply = await show(null); setTabs([{ ...list[0], path: null }]); if (activeRef.current === id) apply(); return; }
      const remaining = list.filter(t => t.id !== id);
      if (activeRef.current !== id) { setTabs(remaining); return; }
      const next = remaining[Math.min(at, remaining.length - 1)];
      await beforeSwitch();
      const apply = await show(next.path);
      setTabs(remaining); setActiveTab(next.id); apply();
    } catch (error) { onError(error); }
  }, [beforeSwitch, onError, show]);
  const create = useCallback(async () => {
    try { await beforeSwitch(); const apply = await show(null); insertAfterActive(blankTab()); apply(); } catch (error) { onError(error); }
  }, [beforeSwitch, insertAfterActive, onError, show]);
  const cycle = useCallback((delta: number) => {
    const list = tabsRef.current;
    const at = list.findIndex(t => t.id === activeRef.current);
    void select(list[(at + delta + list.length) % list.length].id);
  }, [select]);
  // Moves through the active tab's history. `exists` filters out paths that are gone.
  const go = useCallback((delta: number, exists: (path: string) => boolean) => {
    const tab = tabsRef.current.find(t => t.id === activeRef.current);
    if (!tab) return;
    let index = tab.index + delta;
    while (index >= 0 && index < tab.history.length && !exists(tab.history[index])) index += delta;
    if (index < 0 || index >= tab.history.length) return;
    const target = index;
    setTabs(list => list.map(t => t.id === tab.id ? { ...t, index: target } : t));
    void open(tab.history[target], { push: false });
  }, [open]);
  const canGo = useCallback((delta: number, exists: (path: string) => boolean) => {
    const tab = current;
    if (!tab) return false;
    return (delta < 0 ? tab.history.slice(0, tab.index) : tab.history.slice(tab.index + 1)).some(exists);
  }, [current]);
  const remap = useCallback((moved: (path: string) => string) => setTabs(list => list.map(t => ({ ...t, path: t.path ? moved(t.path) : null, history: t.history.map(moved) }))), []);
  const drop = useCallback((gone: (path: string) => boolean) => setTabs(list => list.map(t => { const history = t.history.filter(p => !gone(p)); return { ...t, path: t.path && gone(t.path) ? null : t.path, history, index: Math.min(t.index, history.length - 1) }; })), []);
  const findByPath = useCallback((path: string) => tabsRef.current.find(t => t.path === path) ?? null, []);
  // Replaces all tabs, for a vault load. Unknown paths become empty tabs.
  const restore = useCallback((saved: SavedTabs | null, known: (path: string) => boolean, fallback: string | null) => {
    let list: Tab[] = [];
    let active = 0;
    if (saved?.paths?.length) {
      list = saved.paths.map(path => { const ok = !!path && known(path); return { ...blankTab(), path: ok ? path : null, history: ok ? [path as string] : [], index: ok ? 0 : -1 }; });
      active = Math.min(Math.max(0, saved.active), list.length - 1);
    }
    if (!list.length) list = [{ ...blankTab(), path: fallback, history: fallback ? [fallback] : [], index: fallback ? 0 : -1 }];
    setTabs(list); setActiveTab(list[active].id);
    return list[active];
  }, []);
  const serialize = useCallback((): SavedTabs => ({ paths: tabsRef.current.map(t => t.path), active: tabsRef.current.findIndex(t => t.id === activeRef.current) }), []);

  return { tabs, activeTab, current, activeRef, tabsRef, open, select, close, create, cycle, go, canGo, remap, drop, findByPath, restore, serialize };
}
