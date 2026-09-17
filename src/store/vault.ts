import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { folderOf, isNotePath, makeResolver, noteName, noteStem, parseWiki, WIKI_PATTERN } from '../markdown';
import type { Entry, Note, VaultInfo } from '../types';

const api = window.vault;
export const errorMessage = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The operation failed.';
export const flatten = (entries: Entry[]): string[] => entries.flatMap(entry => entry.kind === 'folder' ? flatten(entry.children || []) : [entry.path]);
export const isEditablePath = (path: string) => isNotePath(path) || path.endsWith('.canvas');

// What changed on disk, after the store reconciled its index.
export type DiskChange = { reset: boolean; removed: string[]; updated: Map<string, string> };
type Options = { onError: (error: unknown) => void; beforeClose?: () => Promise<void> };

// Files, the note index, and saves. Tabs and views are layered on top of this.
export function useVaultStore({ onError, beforeClose }: Options) {
  const beforeCloseRef = useRef(beforeClose); beforeCloseRef.current = beforeClose;
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<Entry[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const notesRef = useRef<Note[]>([]);
  const dirty = useRef(new Map<string, string>());
  const saving = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeHandler = useRef<((change: DiskChange) => void | Promise<void>) | null>(null);
  const allPaths = useMemo(() => flatten(tree), [tree]);
  const resolve = useMemo(() => makeResolver(allPaths), [allPaths]);

  // The index in state drives backlinks, tags, and search. Updates from typing are batched.
  const updateNote = useCallback((path: string, value: string, immediate = false) => {
    if (!isNotePath(path)) return;
    const list = notesRef.current.some(n => n.path === path) ? notesRef.current.map(n => n.path === path ? { path, text: value } : n) : [...notesRef.current, { path, text: value }];
    notesRef.current = list;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    if (immediate) { notesTimer.current = null; setNotes(list); return; }
    notesTimer.current = setTimeout(() => { notesTimer.current = null; setNotes(notesRef.current); }, 1500);
  }, []);
  const replaceNotes = useCallback((list: Note[]) => { notesRef.current = list; setNotes(list); }, []);
  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const run = saving.current.catch(() => {}).then(async () => {
      for (const [path, value] of [...dirty.current]) {
        await api.write(path, value);
        if (dirty.current.get(path) === value) dirty.current.delete(path);
        updateNote(path, value);
      }
    });
    saving.current = run;
    return run.catch(error => { onError(error); throw error; });
  }, [onError, updateNote]);
  const flushQuiet = useCallback(() => flush().catch(() => {}), [flush]);
  const scheduleSave = useCallback((path: string, value: string) => {
    dirty.current.set(path, value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushQuiet(); }, 400);
  }, [flushQuiet]);
  const refresh = useCallback(async (full = false) => {
    const nextTree = await api.tree();
    setTree(nextTree);
    if (full) replaceNotes(await api.index());
    return nextTree;
  }, [replaceNotes]);
  const read = useCallback(async (path: string) => {
    const cached = notesRef.current.find(n => n.path === path)?.text;
    if (cached !== undefined) return cached;
    const value = await api.read(path);
    updateNote(path, value, true);
    return value;
  }, [updateNote]);

  // Opens a vault. Returns the tree and index, or null when no vault is open.
  const load = useCallback(async (next: VaultInfo) => {
    setInfo(next); dirty.current.clear();
    if (!next.vault) { setTree([]); replaceNotes([]); return null; }
    const nextTree = await api.tree(); const index = await api.index();
    setTree(nextTree); replaceNotes(index);
    return { tree: nextTree, index };
  }, [replaceNotes]);

  const createFile = useCallback(async (name: string, text = '', extension: '.md' | '.canvas' = '.md') => {
    const clean = name.replace(/\.(md|canvas)$/i, '').replace(/^\/+|\/+$/g, '');
    const path = await api.createNote(folderOf(clean), clean.split('/').pop() || 'Untitled', text, extension);
    updateNote(path, text, true);
    await refresh();
    return path;
  }, [refresh, updateNote]);
  const createFolder = useCallback(async (folder: string) => { const path = await api.createFolder(folder, 'New folder'); await refresh(); return path; }, [refresh]);

  // Rewrites wikilinks in other notes after a rename.
  const updateLinks = useCallback(async (oldPath: string, newPath: string) => {
    const newName = noteName(newPath), newStem = noteStem(newPath);
    for (const note of notesRef.current) {
      if (note.path === oldPath) continue;
      const changed = note.text.replace(WIKI_PATTERN, (raw, ...rest) => {
        const link = parseWiki([raw, ...rest.slice(0, 4)] as unknown as RegExpMatchArray);
        if (!link.target || resolve(link.target, note.path) !== oldPath) return raw;
        const target = link.target.includes('/') ? newStem : newName;
        return `${link.embed ? '!' : ''}[[${target}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]`;
      });
      if (changed !== note.text) { await api.write(note.path, changed); updateNote(note.path, changed); }
    }
  }, [resolve, updateNote]);
  // Renames or moves a file or folder. Returns a function that maps old paths to new ones.
  const relocate = useCallback(async (path: string, target: string): Promise<((p: string) => string) | null> => {
    if (target === path) return null;
    await flush();
    const newPath = await api.rename(path, target);
    let moved: (p: string) => string;
    if (isEditablePath(path)) {
      if (isNotePath(path)) await updateLinks(path, newPath);
      const value = notesRef.current.find(n => n.path === path)?.text;
      notesRef.current = notesRef.current.filter(n => n.path !== path);
      if (value !== undefined) updateNote(newPath, value, true); else setNotes(notesRef.current);
      moved = p => p === path ? newPath : p;
    } else {
      moved = p => p === path || p.startsWith(`${path}/`) ? newPath + p.slice(path.length) : p;
      replaceNotes(notesRef.current.map(n => ({ ...n, path: moved(n.path) })));
    }
    await refresh();
    return moved;
  }, [flush, refresh, replaceNotes, updateLinks, updateNote]);
  const trash = useCallback(async (path: string) => {
    await flushQuiet();
    dirty.current.delete(path);
    await api.trash(path);
    const gone = (p: string) => p === path || p.startsWith(`${path}/`);
    replaceNotes(notesRef.current.filter(n => !gone(n.path)));
    await refresh();
    return gone;
  }, [flushQuiet, refresh, replaceNotes]);

  // Disk changes from the watcher. The handler set by the app decides what the views do.
  useEffect(() => api.onChanged(async paths => {
    try {
      if (paths.includes('*') || paths.length > 200) {
        await flushQuiet();
        await refresh(true);
        await changeHandler.current?.({ reset: true, removed: [], updated: new Map() });
        return;
      }
      const nextTree = await api.tree();
      setTree(nextTree);
      const existing = new Set(flatten(nextTree));
      const change: DiskChange = { reset: false, removed: [], updated: new Map() };
      // Notes without their own change event, such as files inside a new folder, are read too.
      const missing = [...existing].filter(p => isNotePath(p) && !notesRef.current.some(n => n.path === p)).slice(0, 50);
      for (const path of missing) { const value = await api.read(path).catch(() => null); if (value !== null) updateNote(path, value, true); }
      for (const path of paths) {
        if (!isEditablePath(path)) continue;
        if (!existing.has(path)) {
          if (notesRef.current.some(n => n.path === path)) replaceNotes(notesRef.current.filter(n => n.path !== path));
          if (!dirty.current.has(path)) change.removed.push(path);
          continue;
        }
        if (dirty.current.has(path)) continue;
        const value = await api.read(path).catch(() => null);
        if (value === null || notesRef.current.find(n => n.path === path)?.text === value) continue;
        updateNote(path, value, true);
        change.updated.set(path, value);
      }
      if (change.removed.length || change.updated.size) await changeHandler.current?.(change);
    } catch (error) { void api.log('warn', `change handling failed: ${errorMessage(error)}`); }
  }), [flushQuiet, refresh, replaceNotes, updateNote]);
  // On close, pending note saves and the workspace state are both written before the window goes.
  useEffect(() => api.onClose(() => { void flush().then(() => beforeCloseRef.current?.()).then(() => api.closeReady()).catch(error => api.closeFailed(errorMessage(error))); }), [flush]);
  const onDiskChange = useCallback((handler: (change: DiskChange) => void | Promise<void>) => { changeHandler.current = handler; }, []);

  return { info, setInfo, tree, notes, notesRef, dirty, allPaths, resolve, updateNote, flush, flushQuiet, scheduleSave, refresh, read, load, createFile, createFolder, relocate, trash, onDiskChange };
}
