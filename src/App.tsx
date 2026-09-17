import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, FilePlus, Files, FolderOpen, Link2, ListTree, Moon, Monitor, PanelLeft, PanelRight, Search as SearchIcon, Settings2, Sun, X } from 'lucide-react';
import type { NoteEditor } from './editor';
import { commands as editorCommands } from './editor';
import { backlinks as findBacklinks, countWords, folderOf, fuzzyScore, isNotePath, makeResolver, noteName, noteStem, outline, renderMarkdown, searchNotes, parseWiki, WIKI_PATTERN } from './markdown';
import { NoteView } from './NoteView';
import { Palette, type PaletteItem } from './Palette';
import { BacklinksPane, OutlinePane } from './RightPanel';
import { FileTree, SearchPane, type TreeActions } from './Sidebar';
import type { Entry, Mode, Note, PdfOptions, Theme, VaultInfo } from './types';
import { Dialog, IconButton, Menu, MenuCheck, MenuItem, MenuLabel, MenuSeparator, TooltipProvider, isMac, keys } from './ui';
import { VaultPicker } from './VaultPicker';

const api = window.vault;
const errorMessage = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The operation failed.';
const flatten = (entries: Entry[]): string[] => entries.flatMap(entry => entry.kind === 'folder' ? flatten(entry.children || []) : [entry.path]);
const stored = (key: string, fallback: string) => localStorage.getItem(key) ?? fallback;
type Command = { id: string; name: string; hint?: string; run: () => void; when?: boolean };

export default function App() {
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<Entry[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [history, setHistory] = useState<{ list: string[]; index: number }>({ list: [], index: -1 });
  const [mode, setModeState] = useState<Mode>(() => (['live', 'source', 'reading'].includes(stored('document.mode', 'live')) ? stored('document.mode', 'live') : 'live') as Mode);
  const [left, setLeft] = useState(stored('document.left', '1') === '1');
  const [right, setRight] = useState(stored('document.right', '0') === '1');
  const [leftTab, setLeftTab] = useState<'files' | 'search'>('files');
  const [rightTab, setRightTab] = useState<'outline' | 'backlinks'>('outline');
  const [leftWidth, setLeftWidth] = useState(Math.min(480, Math.max(200, Number(stored('document.leftWidth', '260')) || 260)));
  const [query, setQuery] = useState('');
  const [palette, setPalette] = useState<null | 'files' | 'commands'>(null);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdf, setPdf] = useState<PdfOptions>({ pageSize: 'Letter', margin: 'default', landscape: false, includeTitle: true });
  const [confirmTrash, setConfirmTrash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusTitle, setFocusTitle] = useState(0);
  const [busy, setBusy] = useState(false);

  const editorRef = useRef<NoteEditor | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const dirty = useRef(new Map<string, string>());
  const saving = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef<string | null>(null);
  const renamedRef = useRef<string | null>(null);
  const notesRef = useRef<Note[]>([]);
  const editModeRef = useRef<'live' | 'source'>(mode === 'source' ? 'source' : 'live');
  const commandsRef = useRef<Command[]>([]);

  const vaultPath = info?.vault?.path || '';
  const theme = info?.theme || 'system';
  const allPaths = useMemo(() => flatten(tree), [tree]);
  const resolve = useMemo(() => makeResolver(allPaths), [allPaths]);
  const headings = useMemo(() => outline(text), [text]);
  const counts = useMemo(() => countWords(text), [text]);
  const links = useMemo(() => open ? findBacklinks(open, notes, resolve) : [], [open, notes, resolve]);
  const hits = useMemo(() => searchNotes(query, notes), [query, notes]);
  const fail = useCallback((e: unknown) => setError(errorMessage(e)), []);

  const updateNote = useCallback((path: string, value: string) => {
    const list = notesRef.current.some(n => n.path === path) ? notesRef.current.map(n => n.path === path ? { path, text: value } : n) : [...notesRef.current, { path, text: value }];
    notesRef.current = list; setNotes(list);
  }, []);
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
    return run.catch(e => { fail(e); throw e; });
  }, [fail, updateNote]);
  const refresh = useCallback(async (full = false) => {
    const nextTree = await api.tree();
    setTree(nextTree);
    if (full) { const index = await api.index(); notesRef.current = index; setNotes(index); }
    return nextTree;
  }, []);

  const setMode = useCallback((value: Mode | ((current: Mode) => Mode)) => {
    setModeState(current => { const next = typeof value === 'function' ? value(current) : value; if (next !== 'reading') editModeRef.current = next; localStorage.setItem('document.mode', next); return next; });
  }, []);
  useEffect(() => { localStorage.setItem('document.left', left ? '1' : '0'); }, [left]);
  useEffect(() => { localStorage.setItem('document.right', right ? '1' : '0'); }, [right]);
  useEffect(() => { localStorage.setItem('document.leftWidth', String(leftWidth)); }, [leftWidth]);
  useEffect(() => { if (vaultPath) localStorage.setItem(`document.expanded:${vaultPath}`, JSON.stringify([...expanded])); }, [expanded, vaultPath]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme; };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);

  const openNote = useCallback(async (path: string, options: { push?: boolean; line?: number; from?: number; length?: number; heading?: string } = {}) => {
    try {
      const jump = () => {
        const editor = editorRef.current;
        if (options.heading !== undefined) {
          const index = outline(editor?.text() ?? '').findIndex(h => h.text.toLowerCase() === (options.heading as string).toLowerCase());
          if (index >= 0) {
            if (editModeRef.current && articleRef.current) articleRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ block: 'start' });
            const heading = outline(editor?.text() ?? '')[index];
            if (editor && !articleRef.current) editor.goToLine(heading.line);
          }
        } else if (options.line !== undefined && editor) {
          if (options.length) editor.select(options.line, options.from || 0, options.length); else editor.goToLine(options.line);
        }
      };
      if (openRef.current !== path) {
        await flush().catch(() => {});
        let value = notesRef.current.find(n => n.path === path)?.text;
        if (value === undefined) { value = await api.read(path); updateNote(path, value); }
        openRef.current = path; renamedRef.current = null; setOpen(path); setText(value);
        if (options.push !== false) setHistory(h => { const list = [...h.list.slice(0, h.index + 1), path].slice(-100); return { list, index: list.length - 1 }; });
        localStorage.setItem(`document.lastOpen:${vaultPath}`, path);
        const recent = JSON.parse(stored(`document.recent:${vaultPath}`, '[]')) as string[];
        localStorage.setItem(`document.recent:${vaultPath}`, JSON.stringify([path, ...recent.filter(p => p !== path)].slice(0, 30)));
      }
      if (options.line !== undefined || options.heading !== undefined) setTimeout(jump, 0);
    } catch (e) { fail(e); }
  }, [fail, flush, updateNote, vaultPath]);

  const loadVault = useCallback(async (next: VaultInfo) => {
    setInfo(next); setOpen(null); openRef.current = null; setText(''); setHistory({ list: [], index: -1 }); setQuery(''); setError(''); dirty.current.clear();
    if (!next.vault) { setTree([]); setNotes([]); notesRef.current = []; return; }
    try {
      const nextTree = await api.tree(); const index = await api.index();
      setTree(nextTree); notesRef.current = index; setNotes(index);
      try { setExpanded(new Set(JSON.parse(stored(`document.expanded:${next.vault.path}`, '[]')) as string[])); } catch { setExpanded(new Set()); }
      const last = stored(`document.lastOpen:${next.vault.path}`, '');
      if (last && index.some(n => n.path === last)) void openNote(last);
    } catch (e) { fail(e); }
  }, [fail, openNote]);
  useEffect(() => { api.info().then(loadVault).catch(fail); }, [loadVault, fail]);

  const onChange = useCallback((value: string) => {
    const path = openRef.current;
    if (!path) return;
    setText(value); dirty.current.set(path, value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush().catch(() => {}); }, 400);
  }, [flush]);

  const createNamed = useCallback(async (name: string, focus = false) => {
    try {
      const clean = name.replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
      const path = await api.createNote(folderOf(clean), clean.split('/').pop() || 'Untitled', '');
      updateNote(path, '');
      await refresh();
      if (folderOf(path)) setExpanded(current => new Set([...current, ...folderOf(path).split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))]));
      await openNote(path);
      if (focus) setFocusTitle(n => n + 1);
      setLeftTab('files');
    } catch (e) { fail(e); }
  }, [fail, openNote, refresh, updateNote]);
  const createNote = useCallback((folder: string) => createNamed(folder ? `${folder}/Untitled` : 'Untitled', true), [createNamed]);
  const createFolder = useCallback(async (folder: string) => {
    try {
      const path = await api.createFolder(folder, 'New folder');
      await refresh();
      if (folder) setExpanded(current => new Set([...current, folder]));
      setRenaming(path); setLeft(true); setLeftTab('files');
    } catch (e) { fail(e); }
  }, [fail, refresh]);

  const updateLinks = useCallback(async (oldPath: string, newPath: string) => {
    const before = resolve;
    const newName = noteName(newPath), newStem = noteStem(newPath);
    for (const note of notesRef.current) {
      if (note.path === oldPath) continue;
      const changed = note.text.replace(WIKI_PATTERN, (raw, ...rest) => {
        const match = [raw, ...rest.slice(0, 4)] as unknown as RegExpMatchArray;
        const link = parseWiki(match);
        if (!link.target || before(link.target, note.path) !== oldPath) return raw;
        const target = link.target.includes('/') ? newStem : newName;
        return `${link.embed ? '!' : ''}[[${target}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]`;
      });
      if (changed !== note.text) { await api.write(note.path, changed); updateNote(note.path, changed); }
    }
  }, [resolve, updateNote]);
  const renameEntry = useCallback(async (path: string, name: string) => {
    try {
      const note = isNotePath(path);
      const parent = folderOf(path);
      const target = `${parent ? `${parent}/` : ''}${name}${note ? '.md' : ''}`;
      if (target === path) return;
      await flush();
      const newPath = await api.rename(path, target);
      if (note) {
        await updateLinks(path, newPath);
        const value = notesRef.current.find(n => n.path === path)?.text ?? '';
        notesRef.current = notesRef.current.filter(n => n.path !== path); updateNote(newPath, value);
        editorRef.current?.rename(path, newPath);
        if (openRef.current === path) { openRef.current = newPath; renamedRef.current = newPath; setOpen(newPath); localStorage.setItem(`document.lastOpen:${vaultPath}`, newPath); }
        setHistory(h => ({ ...h, list: h.list.map(p => p === path ? newPath : p) }));
      } else {
        const moved = (p: string) => p === path || p.startsWith(`${path}/`) ? newPath + p.slice(path.length) : p;
        notesRef.current = notesRef.current.map(n => ({ ...n, path: moved(n.path) })); setNotes(notesRef.current);
        setExpanded(current => new Set([...current].map(moved)));
        if (openRef.current && moved(openRef.current) !== openRef.current) { const next = moved(openRef.current); editorRef.current?.rename(openRef.current, next); openRef.current = next; renamedRef.current = next; setOpen(next); }
        setHistory(h => ({ ...h, list: h.list.map(moved) }));
      }
      await refresh();
    } catch (e) { fail(e); await refresh(true).catch(() => {}); }
  }, [fail, flush, refresh, updateLinks, updateNote, vaultPath]);
  const trashEntry = useCallback(async (path: string) => {
    try {
      await flush().catch(() => {});
      dirty.current.delete(path);
      await api.trash(path);
      const gone = (p: string) => p === path || p.startsWith(`${path}/`);
      notesRef.current = notesRef.current.filter(n => !gone(n.path)); setNotes(notesRef.current);
      editorRef.current?.forget(path);
      if (openRef.current && gone(openRef.current)) { openRef.current = null; setOpen(null); setText(''); }
      setHistory(h => { const list = h.list.filter(p => !gone(p)); return { list, index: Math.min(h.index, list.length - 1) }; });
      await refresh();
    } catch (e) { fail(e); }
  }, [fail, flush, refresh]);

  const openLink = useCallback((target: string, heading?: string) => {
    const [name, fragment] = target.split('#');
    const resolved = name ? resolve(name, openRef.current || undefined) : openRef.current;
    if (resolved && isNotePath(resolved)) void openNote(resolved, { heading: heading ?? fragment });
    else if (resolved) void api.reveal(resolved).catch(fail);
    else if (name) void createNamed(name);
  }, [createNamed, fail, openNote, resolve]);
  const openTag = useCallback((tag: string) => { setLeft(true); setLeftTab('search'); setQuery(`#${tag}`); }, []);
  const openExternal = useCallback((url: string) => { void api.openExternal(url).catch(fail); }, [fail]);
  const saveImage = useCallback(async (file: File) => {
    try {
      const path = await api.saveAttachment(file.name || `Pasted image ${Date.now()}.png`, new Uint8Array(await file.arrayBuffer()));
      await refresh();
      return path;
    } catch (e) { fail(e); return null; }
  }, [fail, refresh]);
  const hostRef = useRef({ resolve: (target: string) => resolve(target, openRef.current || undefined), noteNames: () => notesRef.current.map(n => noteStem(n.path)).sort(), openLink, openExternal, openTag, saveImage, onChange });
  hostRef.current = { resolve: (target: string) => resolve(target, openRef.current || undefined), noteNames: () => notesRef.current.map(n => noteStem(n.path)).sort(), openLink, openExternal, openTag, saveImage, onChange };
  const host = useCallback(() => hostRef.current, []);

  const go = useCallback((delta: number) => {
    setHistory(h => {
      let index = h.index + delta;
      while (index >= 0 && index < h.list.length && !notesRef.current.some(n => n.path === h.list[index])) index += delta;
      if (index < 0 || index >= h.list.length) return h;
      void openNote(h.list[index], { push: false });
      return { ...h, index };
    });
  }, [openNote]);
  const chooseVault = useCallback(async (create: boolean) => { try { await flush().catch(() => {}); const next = await api.chooseVault(create); if (next) await loadVault(next); } catch (e) { fail(e); } }, [fail, flush, loadVault]);
  const exportPdf = useCallback(async () => {
    const path = openRef.current;
    if (!path || busy) return;
    setBusy(true);
    try {
      await flush();
      const value = notesRef.current.find(n => n.path === path)?.text ?? '';
      const result = await api.exportPdf(noteName(path), renderMarkdown(value, path, resolve), pdf);
      if (result) setToast(`Exported ${result.fileName}`);
      setPdfOpen(false);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [busy, fail, flush, pdf, resolve]);
  const insertImage = useCallback(async () => {
    try {
      const path = await api.importImage();
      if (!path) return;
      await refresh();
      const view = editorRef.current?.view;
      if (!view) return;
      const at = view.state.selection.main.head;
      view.dispatch({ changes: { from: at, insert: `![[${path}]]` }, selection: { anchor: at + path.length + 5 } });
      view.focus();
    } catch (e) { fail(e); }
  }, [fail, refresh]);
  const setTheme = useCallback((value: Theme) => { setInfo(current => current ? { ...current, theme: value } : current); void api.setTheme(value).catch(fail); }, [fail]);
  const editorCommand = (run: (view: NonNullable<NoteEditor['view']>) => boolean) => () => { const view = editorRef.current?.view; if (view && mode !== 'reading') { run(view); view.focus(); } };

  const commands: Command[] = [
    { id: 'new-note', name: 'New note', hint: keys('Mod+N'), run: () => void createNote('') },
    { id: 'new-folder', name: 'New folder', run: () => void createFolder('') },
    { id: 'quick-switcher', name: 'Open quick switcher', hint: keys('Mod+O'), run: () => { setPaletteQuery(''); setPalette('files'); } },
    { id: 'search', name: 'Search in all notes', hint: keys('Mod+Shift+F'), run: () => { setLeft(true); setLeftTab('search'); setTimeout(() => searchInput.current?.select(), 0); } },
    { id: 'toggle-reading', name: mode === 'reading' ? 'Edit note' : 'Reading view', hint: keys('Mod+E'), run: () => setMode(m => m === 'reading' ? editModeRef.current : 'reading'), when: !!open },
    { id: 'toggle-source', name: mode === 'source' ? 'Live preview' : 'Source mode', run: () => setMode(m => m === 'source' ? 'live' : 'source'), when: !!open },
    { id: 'toggle-left', name: left ? 'Hide left sidebar' : 'Show left sidebar', hint: keys('Mod+Shift+L'), run: () => setLeft(v => !v) },
    { id: 'toggle-right', name: right ? 'Hide right sidebar' : 'Show right sidebar', hint: keys('Mod+Shift+R'), run: () => setRight(v => !v) },
    { id: 'outline', name: 'Show outline', run: () => { setRight(true); setRightTab('outline'); } },
    { id: 'backlinks', name: 'Show backlinks', run: () => { setRight(true); setRightTab('backlinks'); } },
    { id: 'back', name: 'Back', hint: isMac ? '⌃⌥←' : 'Ctrl+Alt+←', run: () => go(-1) },
    { id: 'forward', name: 'Forward', hint: isMac ? '⌃⌥→' : 'Ctrl+Alt+→', run: () => go(1) },
    { id: 'export-pdf', name: 'Export to PDF', hint: keys('Mod+Shift+E'), run: () => setPdfOpen(true), when: !!open },
    { id: 'insert-image', name: 'Insert image from computer', run: () => void insertImage(), when: !!open && mode !== 'reading' },
    { id: 'rename', name: 'Rename note', run: () => setFocusTitle(n => n + 1), when: !!open },
    { id: 'reveal', name: 'Show in file manager', run: () => void (open ? api.reveal(open) : api.revealVault()).catch(fail) },
    { id: 'delete', name: 'Delete note', run: () => setConfirmTrash(open), when: !!open },
    { id: 'bold', name: 'Bold', hint: keys('Mod+B'), run: editorCommand(editorCommands.bold), when: !!open && mode !== 'reading' },
    { id: 'italic', name: 'Italic', hint: keys('Mod+I'), run: editorCommand(editorCommands.italic), when: !!open && mode !== 'reading' },
    { id: 'strike', name: 'Strikethrough', hint: keys('Mod+Shift+X'), run: editorCommand(editorCommands.strike), when: !!open && mode !== 'reading' },
    { id: 'highlight', name: 'Highlight', hint: keys('Mod+Shift+H'), run: editorCommand(editorCommands.highlight), when: !!open && mode !== 'reading' },
    { id: 'code', name: 'Inline code', hint: keys('Mod+`'), run: editorCommand(editorCommands.code), when: !!open && mode !== 'reading' },
    { id: 'link', name: 'Insert link', hint: keys('Mod+K'), run: editorCommand(editorCommands.link), when: !!open && mode !== 'reading' },
    { id: 'bullet', name: 'Bullet list', hint: keys('Mod+Shift+8'), run: editorCommand(editorCommands.bullet), when: !!open && mode !== 'reading' },
    { id: 'number', name: 'Numbered list', hint: keys('Mod+Shift+7'), run: editorCommand(editorCommands.number), when: !!open && mode !== 'reading' },
    { id: 'task', name: 'Task list', hint: keys('Mod+L'), run: editorCommand(editorCommands.task), when: !!open && mode !== 'reading' },
    { id: 'quote', name: 'Quote', hint: keys('Mod+Shift+.'), run: editorCommand(editorCommands.quote), when: !!open && mode !== 'reading' },
    ...[1, 2, 3].map(level => ({ id: `heading-${level}`, name: `Heading ${level}`, run: editorCommand(editorCommands.heading(level)), when: !!open && mode !== 'reading' })),
    { id: 'theme-system', name: 'Theme: match system', run: () => setTheme('system') },
    { id: 'theme-light', name: 'Theme: light', run: () => setTheme('light') },
    { id: 'theme-dark', name: 'Theme: dark', run: () => setTheme('dark') },
    { id: 'command-palette', name: 'Command palette', hint: keys('Mod+P'), run: () => { setPaletteQuery(''); setPalette('commands'); } },
    { id: 'open-vault', name: 'Open another vault', run: () => void chooseVault(false) },
    { id: 'close-vault', name: 'Close vault', run: () => void flush().catch(() => {}).then(() => api.closeVault()).then(loadVault).catch(fail) },
  ];
  commandsRef.current = commands;
  useEffect(() => api.onCommand(name => { const command = commandsRef.current.find(c => c.id === name); if (command && command.when !== false) command.run(); }), []);
  useEffect(() => api.onClose(() => { void flush().then(() => api.closeReady()).catch(e => api.closeFailed(errorMessage(e))); }), [flush]);
  useEffect(() => api.onChanged(async paths => {
    try {
      const nextTree = await api.tree();
      setTree(nextTree);
      const existing = new Set(flatten(nextTree));
      for (const path of paths) {
        if (!isNotePath(path)) continue;
        if (!existing.has(path)) {
          if (!notesRef.current.some(n => n.path === path)) continue;
          notesRef.current = notesRef.current.filter(n => n.path !== path); setNotes(notesRef.current);
          if (openRef.current === path && !dirty.current.has(path)) { openRef.current = null; setOpen(null); setText(''); }
          continue;
        }
        if (dirty.current.has(path)) continue;
        const value = await api.read(path).catch(() => null);
        if (value === null || notesRef.current.find(n => n.path === path)?.text === value) continue;
        updateNote(path, value);
        if (openRef.current === path) setText(value);
      }
    } catch { /* the next change repeats the refresh */ }
  }), [updateNote]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = isMac ? event.metaKey : event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      const run = (id: string) => { event.preventDefault(); commandsRef.current.find(c => c.id === id)?.run(); };
      if (key === 'o' && !event.shiftKey) run('quick-switcher');
      else if (key === 'p' && !event.shiftKey) run('command-palette');
      else if (key === 'n' && !event.shiftKey) run('new-note');
      else if (key === 'e' && !event.shiftKey) { if (open) run('toggle-reading'); }
      else if (key === 'f' && event.shiftKey) run('search');
      else if (key === 'l' && event.shiftKey) run('toggle-left');
      else if (key === 'r' && event.shiftKey) run('toggle-right');
      else if (key === 'e' && event.shiftKey) { if (open) run('export-pdf'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const treeActions: TreeActions = useMemo(() => ({
    open: path => void openNote(path),
    createNote: folder => void createNote(folder),
    createFolder: folder => void createFolder(folder),
    rename: (path, name) => void renameEntry(path, name),
    trash: path => setConfirmTrash(path),
    reveal: path => void (path ? api.reveal(path) : api.revealVault()).catch(fail),
  }), [createFolder, createNote, fail, openNote, renameEntry]);
  const toggleFolder = useCallback((path: string) => setExpanded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; }), []);

  const paletteItems: PaletteItem[] = useMemo(() => {
    const q = paletteQuery.trim();
    if (palette === 'commands') {
      return commands.filter(c => c.when !== false).map(c => ({ c, score: fuzzyScore(q, c.name) })).filter(x => x.score !== null).sort((a, b) => (b.score as number) - (a.score as number)).map(({ c }) => ({ id: c.id, label: c.name, hint: c.hint, run: c.run }));
    }
    if (palette !== 'files') return [];
    const paths = notes.map(n => n.path);
    let ordered: string[];
    if (q) ordered = paths.map(p => ({ p, score: fuzzyScore(q, noteStem(p)) })).filter(x => x.score !== null).sort((a, b) => (b.score as number) - (a.score as number)).slice(0, 60).map(x => x.p);
    else { const recent = (JSON.parse(stored(`document.recent:${vaultPath}`, '[]')) as string[]).filter(p => paths.includes(p)); ordered = [...recent, ...paths.filter(p => !recent.includes(p)).sort()].slice(0, 60); }
    const items: PaletteItem[] = ordered.map(p => ({ id: p, label: noteName(p), detail: folderOf(p) || undefined, run: () => void openNote(p) }));
    if (q && !paths.some(p => noteStem(p).toLowerCase() === q.toLowerCase() || noteName(p).toLowerCase() === q.toLowerCase())) items.push({ id: '__create', label: `Create "${q}"`, detail: 'New note', hint: 'Enter', run: () => void createNamed(q) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, paletteQuery, notes, vaultPath]);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX, startWidth = leftWidth;
    const move = (e: MouseEvent) => setLeftWidth(Math.min(480, Math.max(200, startWidth + e.clientX - startX)));
    const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); document.body.classList.remove('is-resizing'); };
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);
  };

  if (!info) return <div className="app-loading" />;
  if (!info.vault) return <TooltipProvider delayDuration={400}><div className={`app is-picker ${isMac ? 'is-mac' : ''}`}><VaultPicker recent={info.recent} error={error} onChoose={create => void chooseVault(create)} onOpen={path => api.openVault(path).then(loadVault).catch(fail)} onForget={path => api.forgetVault(path).then(setInfo).catch(fail)} /></div></TooltipProvider>;

  return <TooltipProvider delayDuration={400}><div className={`app ${isMac ? 'is-mac' : ''}`} style={{ '--left-width': `${leftWidth}px` } as React.CSSProperties}>
    <aside className={`sidebar sidebar-left ${left ? '' : 'is-collapsed'}`} aria-label="Left sidebar" aria-hidden={!left}>
      <div className="sidebar-tabs">
        <IconButton label="Files" active={leftTab === 'files'} onClick={() => setLeftTab('files')}><Files size={17} /></IconButton>
        <IconButton label={`Search (${keys('Mod+Shift+F')})`} active={leftTab === 'search'} onClick={() => { setLeftTab('search'); setTimeout(() => searchInput.current?.focus(), 0); }}><SearchIcon size={17} /></IconButton>
        <span className="sidebar-tabs-space" />
        <IconButton label={`Hide sidebar (${keys('Mod+Shift+L')})`} onClick={() => setLeft(false)}><PanelLeft size={17} /></IconButton>
      </div>
      {leftTab === 'files' ? <FileTree vaultName={info.vault.name} tree={tree} openPath={open} expanded={expanded} toggle={toggleFolder} collapseAll={() => setExpanded(new Set())} actions={treeActions} renaming={renaming} setRenaming={setRenaming} />
        : <SearchPane query={query} setQuery={setQuery} hits={hits} inputRef={searchInput} onOpen={(path, line, from, length) => void openNote(path, { line, from, length })} />}
      <div className="sidebar-footer">
        <Menu align="start" trigger={<button type="button" className="vault-switcher" aria-label="Vault options"><span className="vault-name">{info.vault.name}</span><ChevronDown size={14} /></button>}>
          <MenuLabel>{info.vault.path}</MenuLabel>
          <MenuItem onSelect={() => void chooseVault(false)}><FolderOpen size={15} />Open another vault…</MenuItem>
          <MenuItem onSelect={() => void chooseVault(true)}><FilePlus size={15} />Create new vault…</MenuItem>
          {info.recent.filter(p => p !== info.vault?.path).length > 0 && <MenuSeparator />}
          {info.recent.filter(p => p !== info.vault?.path).map(p => <MenuItem key={p} onSelect={() => void flush().catch(() => {}).then(() => api.openVault(p)).then(loadVault).catch(fail)}>{p.split(/[\\/]/).pop()}</MenuItem>)}
          <MenuSeparator />
          <MenuItem onSelect={() => void api.revealVault().catch(fail)}>Show vault in file manager</MenuItem>
          <MenuItem onSelect={() => void flush().catch(() => {}).then(() => api.closeVault()).then(loadVault).catch(fail)}>Close vault</MenuItem>
        </Menu>
        <Menu align="end" trigger={<button type="button" className="icon-button" aria-label="Settings"><Settings2 size={16} /></button>}>
          <MenuLabel>Theme</MenuLabel>
          <MenuCheck checked={theme === 'system'} onSelect={() => setTheme('system')}><Monitor size={15} />Match system</MenuCheck>
          <MenuCheck checked={theme === 'light'} onSelect={() => setTheme('light')}><Sun size={15} />Light</MenuCheck>
          <MenuCheck checked={theme === 'dark'} onSelect={() => setTheme('dark')}><Moon size={15} />Dark</MenuCheck>
          <MenuSeparator />
          <MenuLabel>Editor</MenuLabel>
          <MenuCheck checked={mode === 'live'} onSelect={() => setMode('live')}>Live preview</MenuCheck>
          <MenuCheck checked={mode === 'source'} onSelect={() => setMode('source')}>Source mode</MenuCheck>
          <MenuCheck checked={mode === 'reading'} onSelect={() => setMode('reading')}>Reading view</MenuCheck>
        </Menu>
      </div>
    </aside>
    {left && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onMouseDown={startResize} />}
    <main className="workspace">
      <div className="workspace-bar">
        <div className="workspace-nav">
          {!left && <IconButton label={`Show sidebar (${keys('Mod+Shift+L')})`} onClick={() => setLeft(true)}><PanelLeft size={17} /></IconButton>}
          <IconButton label="Back" disabled={!history.list.slice(0, history.index).some(p => notes.some(n => n.path === p))} onClick={() => go(-1)}><ArrowLeft size={17} /></IconButton>
          <IconButton label="Forward" disabled={!history.list.slice(history.index + 1).some(p => notes.some(n => n.path === p))} onClick={() => go(1)}><ArrowRight size={17} /></IconButton>
        </div>
        <div className="workspace-nav">
          {!right && <IconButton label={`Show right sidebar (${keys('Mod+Shift+R')})`} onClick={() => setRight(true)}><PanelRight size={17} /></IconButton>}
        </div>
      </div>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => void flush().then(() => setError('')).catch(() => {})}>Retry</button><button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button></div>}
      {open ? <NoteView path={open} text={text} mode={mode} resolve={resolve} host={host} editorRef={editorRef} articleRef={articleRef} focusTitle={focusTitle} justRenamed={renamedRef.current === open}
        onRename={name => renameEntry(open, name)} onToggleReading={() => setMode(m => m === 'reading' ? editModeRef.current : 'reading')} onToggleSource={() => setMode(m => m === 'source' ? 'live' : 'source')}
        onExport={() => setPdfOpen(true)} onReveal={() => void api.reveal(open).catch(fail)} onTrash={() => setConfirmTrash(open)} onOpenLink={openLink} onOpenTag={openTag} onOpenExternal={openExternal} />
        : <div className="empty-state">
          <p className="empty-title">No note is open</p>
          <div className="empty-actions">
            <button type="button" onClick={() => void createNote('')}>New note<kbd>{keys('Mod+N')}</kbd></button>
            <button type="button" onClick={() => { setPaletteQuery(''); setPalette('files'); }}>Go to note<kbd>{keys('Mod+O')}</kbd></button>
            <button type="button" onClick={() => { setPaletteQuery(''); setPalette('commands'); }}>Command palette<kbd>{keys('Mod+P')}</kbd></button>
          </div>
        </div>}
      {open && <div className="status-bar" role="status" aria-live="off"><span>{counts.words.toLocaleString()} {counts.words === 1 ? 'word' : 'words'}</span><span>{counts.characters.toLocaleString()} {counts.characters === 1 ? 'character' : 'characters'}</span></div>}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
    <aside className={`sidebar sidebar-right ${right ? '' : 'is-collapsed'}`} aria-label="Right sidebar" aria-hidden={!right}>
      <div className="sidebar-tabs">
        <IconButton label="Outline" active={rightTab === 'outline'} onClick={() => setRightTab('outline')}><ListTree size={17} /></IconButton>
        <IconButton label="Backlinks" active={rightTab === 'backlinks'} onClick={() => setRightTab('backlinks')}><Link2 size={17} /></IconButton>
        <span className="sidebar-tabs-space" />
        <IconButton label={`Hide right sidebar (${keys('Mod+Shift+R')})`} onClick={() => setRight(false)}><PanelRight size={17} /></IconButton>
      </div>
      {!open ? <div className="pane"><p className="pane-empty">Open a note to see its {rightTab}.</p></div>
        : rightTab === 'outline' ? <OutlinePane headings={headings} onSelect={(index, line) => { if (mode === 'reading') articleRef.current?.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' }); else editorRef.current?.goToLine(line); }} />
          : <BacklinksPane links={links} onOpen={(path, line) => void openNote(path, { line })} />}
    </aside>

    <Palette open={palette === 'files'} title="Quick switcher" placeholder="Find or create a note…" items={paletteItems} query={paletteQuery} onQuery={setPaletteQuery} onClose={() => setPalette(null)} empty="No notes found" />
    <Palette open={palette === 'commands'} title="Command palette" placeholder="Select a command…" items={paletteItems} query={paletteQuery} onQuery={setPaletteQuery} onClose={() => setPalette(null)} empty="No commands found" />
    <Dialog open={pdfOpen} onOpenChange={setPdfOpen} title="Export to PDF" description={open ? noteName(open) : ''}>
      <form className="form" onSubmit={e => { e.preventDefault(); void exportPdf(); }}>
        <label>Page size<select value={pdf.pageSize} onChange={e => setPdf({ ...pdf, pageSize: e.target.value as PdfOptions['pageSize'] })}><option>Letter</option><option>A4</option><option>Legal</option></select></label>
        <label>Margin<select value={pdf.margin} onChange={e => setPdf({ ...pdf, margin: e.target.value as PdfOptions['margin'] })}><option value="default">Default</option><option value="minimal">Minimal</option><option value="none">None</option></select></label>
        <label className="check"><input type="checkbox" checked={pdf.landscape} onChange={e => setPdf({ ...pdf, landscape: e.target.checked })} />Landscape</label>
        <label className="check"><input type="checkbox" checked={pdf.includeTitle} onChange={e => setPdf({ ...pdf, includeTitle: e.target.checked })} />Include the note title</label>
        <div className="form-actions"><button type="button" onClick={() => setPdfOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Exporting…' : 'Export'}</button></div>
      </form>
    </Dialog>
    <Dialog open={confirmTrash !== null} onOpenChange={value => { if (!value) setConfirmTrash(null); }} title={confirmTrash && isNotePath(confirmTrash) ? 'Delete note?' : 'Delete folder?'} description={confirmTrash ? `${confirmTrash} moves to the system trash.` : ''}>
      <div className="form-actions"><button type="button" onClick={() => setConfirmTrash(null)}>Cancel</button><button type="button" className="danger" onClick={() => { const path = confirmTrash; setConfirmTrash(null); if (path) void trashEntry(path); }}>Delete</button></div>
    </Dialog>
  </div></TooltipProvider>;
}
