import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, Check, ChevronDown, FilePlus, Files, FolderOpen, Hash, Link2, ListTree, Moon, Monitor, PanelLeft, PanelRight, Plus, Search as SearchIcon, Settings2, SlidersHorizontal, Sun, X } from 'lucide-react';
import type { EditorView } from '@codemirror/view';
import type { NoteEditor } from './editor';
import { commands as editorCommands } from './editor';
import { backlinks as findBacklinks, countWords, folderOf, fuzzyScore, isNotePath, makeResolver, noteName, noteStem, outline, renderMarkdown, searchNotes, parseWiki, tagCounts, WIKI_PATTERN } from './markdown';
import { NoteView } from './NoteView';
import { DEFAULT_FORMAT, applyFormat, formatOf, parseFrontmatter, stripFrontmatter, type DocumentFormat } from './frontmatter';
import { Palette, type PaletteItem } from './Palette';
import { BacklinksPane, FormatPane, OutlinePane } from './RightPanel';
import { SelectionToolbar } from './SelectionToolbar';
import { FileTree, SearchPane, TagsPane, type TreeActions } from './Sidebar';
import type { Entry, Mode, Note, PdfOptions, Theme, VaultInfo } from './types';
import { Dialog, IconButton, Menu, MenuCheck, MenuItem, MenuLabel, MenuSeparator, TooltipProvider, isMac, keys } from './ui';
import { VaultPicker } from './VaultPicker';

const api = window.vault;
const isWindows = api.platform === 'win32';
const errorMessage = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The operation failed.';
const flatten = (entries: Entry[]): string[] => entries.flatMap(entry => entry.kind === 'folder' ? flatten(entry.children || []) : [entry.path]);
const stored = (key: string, fallback: string) => localStorage.getItem(key) ?? fallback;
type Command = { id: string; name: string; hint?: string; run: () => void; when?: boolean };
type Tab = { id: number; path: string | null; history: string[]; index: number };
let nextTabId = 1;
const blankTab = (): Tab => ({ id: nextTabId++, path: null, history: [], index: -1 });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function App() {
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<Entry[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tabs, setTabs] = useState<Tab[]>(() => [blankTab()]);
  const [activeTab, setActiveTab] = useState<number>(() => 1);
  const [text, setText] = useState('');
  const [mode, setModeState] = useState<Mode>(() => (['live', 'source', 'reading'].includes(stored('document.mode', 'live')) ? stored('document.mode', 'live') : 'live') as Mode);
  const [left, setLeft] = useState(stored('document.left', '1') === '1');
  const [right, setRight] = useState(stored('document.right', '0') === '1');
  const [leftTab, setLeftTab] = useState<'files' | 'search' | 'tags'>('files');
  const [rightTab, setRightTab] = useState<'outline' | 'backlinks' | 'format'>('outline');
  const [leftWidth, setLeftWidth] = useState(Math.min(480, Math.max(200, Number(stored('document.leftWidth', '260')) || 260)));
  const [query, setQuery] = useState('');
  const [palette, setPalette] = useState<null | 'files' | 'commands'>(null);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [exportKind, setExportKind] = useState<'pdf' | 'docx'>('pdf');
  const [pdf, setPdf] = useState<PdfOptions>({ ...DEFAULT_FORMAT, pageSize: 'Letter', landscape: false, includeTitle: true });
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
  const tabsRef = useRef<Tab[]>(tabs); tabsRef.current = tabs;
  const activeRef = useRef(activeTab); activeRef.current = activeTab;
  const editModeRef = useRef<'live' | 'source'>(mode === 'source' ? 'source' : 'live');
  const commandsRef = useRef<Command[]>([]);
  const tabsReady = useRef(false);

  const vaultPath = info?.vault?.path || '';
  const theme = info?.theme || 'system';
  const current = tabs.find(t => t.id === activeTab) ?? tabs[0];
  const open = current?.path ?? null;
  const allPaths = useMemo(() => flatten(tree), [tree]);
  const resolve = useMemo(() => makeResolver(allPaths), [allPaths]);
  const headings = useMemo(() => outline(text), [text]);
  const counts = useMemo(() => countWords(text), [text]);
  const format = useMemo(() => formatOf(text), [text]);
  const links = useMemo(() => open ? findBacklinks(open, notes, resolve) : [], [open, notes, resolve]);
  const hits = useMemo(() => searchNotes(query, notes), [query, notes]);
  const tags = useMemo(() => tagCounts(notes), [notes]);
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
  useEffect(() => { if (vaultPath && tabsReady.current) localStorage.setItem(`document.tabs:${vaultPath}`, JSON.stringify({ paths: tabs.map(t => t.path), active: tabs.findIndex(t => t.id === activeTab) })); }, [tabs, activeTab, vaultPath]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const effective = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = effective;
      void api.setChrome(effective).catch(() => {});
    };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);

  // Loads a note's text into the view without touching tab history.
  const showPath = useCallback(async (path: string | null) => {
    if (!path) { openRef.current = null; renamedRef.current = null; setText(''); return; }
    let value = notesRef.current.find(n => n.path === path)?.text;
    if (value === undefined) { value = await api.read(path); updateNote(path, value); }
    openRef.current = path; renamedRef.current = null; setText(value);
    localStorage.setItem(`document.lastOpen:${vaultPath}`, path);
    const recent = JSON.parse(stored(`document.recent:${vaultPath}`, '[]')) as string[];
    localStorage.setItem(`document.recent:${vaultPath}`, JSON.stringify([path, ...recent.filter(p => p !== path)].slice(0, 30)));
  }, [updateNote, vaultPath]);

  const openNote = useCallback(async (path: string, options: { push?: boolean; newTab?: boolean; line?: number; from?: number; length?: number; heading?: string } = {}) => {
    try {
      const jump = () => {
        const editor = editorRef.current;
        if (options.heading !== undefined) {
          const index = outline(editor?.text() ?? '').findIndex(h => h.text.toLowerCase() === (options.heading as string).toLowerCase());
          if (index >= 0) {
            if (articleRef.current) articleRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ block: 'start' });
            else if (editor) editor.goToLine(outline(editor.text())[index].line);
          }
        } else if (options.line !== undefined && editor) {
          if (options.length) editor.select(options.line, options.from || 0, options.length); else editor.goToLine(options.line);
        }
      };
      if (options.newTab) {
        await flush().catch(() => {});
        const tab: Tab = { ...blankTab(), path, history: [path], index: 0 };
        setTabs(list => { const at = list.findIndex(t => t.id === activeRef.current); return [...list.slice(0, at + 1), tab, ...list.slice(at + 1)]; });
        setActiveTab(tab.id);
        await showPath(path);
      } else if (openRef.current !== path) {
        await flush().catch(() => {});
        const id = activeRef.current;
        setTabs(list => list.map(t => {
          if (t.id !== id) return t;
          if (options.push === false) return { ...t, path };
          const history = [...t.history.slice(0, t.index + 1), path].slice(-100);
          return { ...t, path, history, index: history.length - 1 };
        }));
        await showPath(path);
      }
      if (options.line !== undefined || options.heading !== undefined) setTimeout(jump, 0);
    } catch (e) { fail(e); }
  }, [fail, flush, showPath]);

  const selectTab = useCallback(async (id: number) => {
    if (id === activeRef.current) return;
    const tab = tabsRef.current.find(t => t.id === id);
    if (!tab) return;
    try { await flush().catch(() => {}); setActiveTab(id); await showPath(tab.path); } catch (e) { fail(e); }
  }, [fail, flush, showPath]);
  const closeTab = useCallback(async (id: number) => {
    const list = tabsRef.current;
    const at = list.findIndex(t => t.id === id);
    if (at < 0) return;
    if (list.length === 1) { setTabs([{ ...list[0], path: null }]); if (activeRef.current === id) await showPath(null); return; }
    const remaining = list.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeRef.current === id) {
      const next = remaining[Math.min(at, remaining.length - 1)];
      try { await flush().catch(() => {}); setActiveTab(next.id); await showPath(next.path); } catch (e) { fail(e); }
    }
  }, [fail, flush, showPath]);
  const newTab = useCallback(async () => {
    await flush().catch(() => {});
    const tab = blankTab();
    setTabs(list => { const at = list.findIndex(t => t.id === activeRef.current); return [...list.slice(0, at + 1), tab, ...list.slice(at + 1)]; });
    setActiveTab(tab.id);
    await showPath(null);
  }, [flush, showPath]);
  const cycleTab = useCallback((delta: number) => {
    const list = tabsRef.current;
    const at = list.findIndex(t => t.id === activeRef.current);
    void selectTab(list[(at + delta + list.length) % list.length].id);
  }, [selectTab]);

  const loadVault = useCallback(async (next: VaultInfo) => {
    // The saved tabs are read before any render can persist the blank start state.
    tabsReady.current = false;
    let saved: { paths: (string | null)[]; active: number } | null = null;
    try { saved = next.vault ? JSON.parse(stored(`document.tabs:${next.vault.path}`, 'null')) : null; } catch { saved = null; }
    setInfo(next); openRef.current = null; setText(''); setQuery(''); setError(''); dirty.current.clear();
    if (!next.vault) { setTree([]); setNotes([]); notesRef.current = []; setTabs([blankTab()]); return; }
    try {
      const nextTree = await api.tree(); const index = await api.index();
      setTree(nextTree); notesRef.current = index; setNotes(index);
      try { setExpanded(new Set(JSON.parse(stored(`document.expanded:${next.vault.path}`, '[]')) as string[])); } catch { setExpanded(new Set()); }
      let restored: Tab[] = [];
      let active = 0;
      if (saved?.paths?.length) { restored = saved.paths.map(path => ({ ...blankTab(), path: path && index.some(n => n.path === path) ? path : null, history: path ? [path] : [], index: path ? 0 : -1 })); active = Math.min(Math.max(0, saved.active), restored.length - 1); }
      if (!restored.length) {
        const last = stored(`document.lastOpen:${next.vault.path}`, '');
        const path = last && index.some(n => n.path === last) ? last : null;
        restored = [{ ...blankTab(), path, history: path ? [path] : [], index: path ? 0 : -1 }];
      }
      setTabs(restored); setActiveTab(restored[active].id);
      tabsReady.current = true;
      await showPath(restored[active].path);
    } catch (e) { fail(e); }
  }, [fail, showPath]);
  useEffect(() => { api.info().then(loadVault).catch(fail); }, [loadVault, fail]);

  const onChange = useCallback((value: string) => {
    const path = openRef.current;
    if (!path) return;
    setText(value); dirty.current.set(path, value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush().catch(() => {}); }, 400);
  }, [flush]);

  const createNamed = useCallback(async (name: string, focus = false, text = '') => {
    try {
      const clean = name.replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
      const path = await api.createNote(folderOf(clean), clean.split('/').pop() || 'Untitled', text);
      updateNote(path, text);
      await refresh();
      if (folderOf(path)) setExpanded(current => new Set([...current, ...folderOf(path).split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))]));
      await openNote(path);
      if (focus) setFocusTitle(n => n + 1);
      setLeftTab('files');
      return path;
    } catch (e) { fail(e); return null; }
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
  const openDailyNote = useCallback(async () => {
    const path = `Daily/${today()}.md`;
    if (notesRef.current.some(n => n.path === path)) await openNote(path);
    else await createNamed(path, false, `# ${today()}\n\n`);
  }, [createNamed, openNote]);

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
  const remapTabs = useCallback((moved: (path: string) => string) => {
    setTabs(list => list.map(t => ({ ...t, path: t.path ? moved(t.path) : null, history: t.history.map(moved) })));
  }, []);
  // Renames or moves a note or folder. `target` is the new vault-relative path.
  const relocate = useCallback(async (path: string, target: string) => {
    try {
      if (target === path) return;
      const note = isNotePath(path);
      await flush();
      const newPath = await api.rename(path, target);
      if (note) {
        await updateLinks(path, newPath);
        const value = notesRef.current.find(n => n.path === path)?.text ?? '';
        notesRef.current = notesRef.current.filter(n => n.path !== path); updateNote(newPath, value);
        editorRef.current?.rename(path, newPath);
        if (openRef.current === path) { openRef.current = newPath; renamedRef.current = newPath; localStorage.setItem(`document.lastOpen:${vaultPath}`, newPath); }
        remapTabs(p => p === path ? newPath : p);
      } else {
        const moved = (p: string) => p === path || p.startsWith(`${path}/`) ? newPath + p.slice(path.length) : p;
        notesRef.current = notesRef.current.map(n => ({ ...n, path: moved(n.path) })); setNotes(notesRef.current);
        setExpanded(current => new Set([...current].map(moved)));
        if (openRef.current && moved(openRef.current) !== openRef.current) { const next = moved(openRef.current); editorRef.current?.rename(openRef.current, next); openRef.current = next; renamedRef.current = next; }
        remapTabs(moved);
      }
      await refresh();
    } catch (e) { fail(e); await refresh(true).catch(() => {}); }
  }, [fail, flush, refresh, remapTabs, updateLinks, updateNote, vaultPath]);
  const renameEntry = useCallback((path: string, name: string) => relocate(path, `${folderOf(path) ? `${folderOf(path)}/` : ''}${name}${isNotePath(path) ? '.md' : ''}`), [relocate]);
  const moveEntry = useCallback((path: string, folder: string) => relocate(path, `${folder ? `${folder}/` : ''}${path.split('/').pop()}`), [relocate]);
  const trashEntry = useCallback(async (path: string) => {
    try {
      await flush().catch(() => {});
      dirty.current.delete(path);
      await api.trash(path);
      const gone = (p: string) => p === path || p.startsWith(`${path}/`);
      notesRef.current = notesRef.current.filter(n => !gone(n.path)); setNotes(notesRef.current);
      editorRef.current?.forget(path);
      setTabs(list => list.map(t => { const history = t.history.filter(p => !gone(p)); return { ...t, path: t.path && gone(t.path) ? null : t.path, history, index: Math.min(t.index, history.length - 1) }; }));
      if (openRef.current && gone(openRef.current)) await showPath(null);
      await refresh();
    } catch (e) { fail(e); }
  }, [fail, flush, refresh, showPath]);

  const openLink = useCallback((target: string, heading?: string, newTab = false) => {
    const [name, fragment] = target.split('#');
    const resolved = name ? resolve(name, openRef.current || undefined) : openRef.current;
    if (resolved && isNotePath(resolved)) void openNote(resolved, { heading: heading ?? fragment, newTab });
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
  // Format changes rewrite only the frontmatter block through the editor, so undo works.
  const setFormat = useCallback((patch: Partial<DocumentFormat>) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const current = view.state.doc.toString();
    const next = applyFormat(current, patch);
    if (next === current) return;
    const oldEnd = parseFrontmatter(current)?.end ?? 0, newEnd = parseFrontmatter(next)?.end ?? 0;
    view.dispatch({ changes: { from: 0, to: oldEnd, insert: next.slice(0, newEnd) } });
  }, []);
  const openFormat = useCallback(() => { setRight(true); setRightTab('format'); }, []);
  const openPdf = useCallback((kind: 'pdf' | 'docx' = 'pdf') => {
    const current = formatOf(editorRef.current?.text() ?? '');
    setPdf(previous => ({ ...previous, pageSize: current.paper, margin: current.margin, pageNumbers: current.pageNumbers }));
    setExportKind(kind);
    setPdfOpen(true);
  }, []);
  const mountToolbar = useCallback((dom: HTMLElement, view: EditorView) => {
    const root = createRoot(dom);
    root.render(<TooltipProvider delayDuration={400}><SelectionToolbar view={view} onInsertImage={() => void insertImage()} /></TooltipProvider>);
    return () => { setTimeout(() => root.unmount(), 0); };
  }, [insertImage]);
  const preview = useCallback((target: string) => {
    const resolved = resolve(target, openRef.current || undefined);
    if (!resolved || !isNotePath(resolved)) return null;
    const note = notesRef.current.find(n => n.path === resolved);
    if (!note) return null;
    const body = stripFrontmatter(note.text).slice(0, 2500);
    return { title: noteName(resolved), html: renderMarkdown(body, resolved, resolve) || '<p class="pane-empty">Empty note</p>' };
  }, [resolve]);
  const hostValue = { resolve: (target: string) => resolve(target, openRef.current || undefined), noteNames: () => notesRef.current.map(n => noteStem(n.path)).sort(), openLink, openExternal, openTag, saveImage, onChange, openFormat, mountToolbar, preview };
  const hostRef = useRef(hostValue);
  hostRef.current = hostValue;
  const host = useCallback(() => hostRef.current, []);

  const go = useCallback((delta: number) => {
    const tab = tabsRef.current.find(t => t.id === activeRef.current);
    if (!tab) return;
    let index = tab.index + delta;
    while (index >= 0 && index < tab.history.length && !notesRef.current.some(n => n.path === tab.history[index])) index += delta;
    if (index < 0 || index >= tab.history.length) return;
    const target = index;
    setTabs(list => list.map(t => t.id === tab.id ? { ...t, index: target } : t));
    void openNote(tab.history[target], { push: false });
  }, [openNote]);
  const chooseVault = useCallback(async (create: boolean) => { try { await flush().catch(() => {}); const next = await api.chooseVault(create); if (next) await loadVault(next); } catch (e) { fail(e); } }, [fail, flush, loadVault]);
  const exportPdf = useCallback(async () => {
    const path = openRef.current;
    if (!path || busy) return;
    setBusy(true);
    try {
      await flush();
      const value = notesRef.current.find(n => n.path === path)?.text ?? '';
      const current = formatOf(value);
      const options = { ...pdf, font: current.font, size: current.size, lineHeight: current.lineHeight, align: current.align, indent: current.indent };
      let result: { fileName: string } | null;
      if (exportKind === 'docx') {
        // The Word converter runs in the main process. Image targets are resolved here.
        const images: Record<string, string> = {};
        for (const match of value.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)\)/g)) {
          const target = (match[1] || decodeURIComponent(match[2] || '')).trim();
          const resolved = target ? resolve(target, path) : null;
          if (resolved) images[target] = resolved;
        }
        result = await api.exportDocx(noteName(path), value, options, images);
      } else result = await api.exportPdf(noteName(path), renderMarkdown(value, path, resolve), options);
      if (result) setToast(`Exported ${result.fileName}`);
      setPdfOpen(false);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [busy, exportKind, fail, flush, pdf, resolve]);
  const setTheme = useCallback((value: Theme) => { setInfo(current => current ? { ...current, theme: value } : current); void api.setTheme(value).catch(fail); }, [fail]);
  const editorCommand = (run: (view: EditorView) => boolean) => () => { const view = editorRef.current?.view; if (view && mode !== 'reading') { run(view); view.focus(); } };
  const editing = !!open && mode !== 'reading';

  const commands: Command[] = [
    { id: 'new-note', name: 'New note', hint: keys('Mod+N'), run: () => void createNote('') },
    { id: 'new-folder', name: 'New folder', run: () => void createFolder('') },
    { id: 'new-tab', name: 'New tab', hint: keys('Mod+T'), run: () => void newTab() },
    { id: 'close-tab', name: 'Close tab', hint: keys('Mod+W'), run: () => void closeTab(activeRef.current) },
    { id: 'next-tab', name: 'Next tab', hint: 'Ctrl+Tab', run: () => cycleTab(1) },
    { id: 'previous-tab', name: 'Previous tab', hint: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },
    { id: 'quick-switcher', name: 'Open quick switcher', hint: keys('Mod+O'), run: () => { setPaletteQuery(''); setPalette('files'); } },
    { id: 'search', name: 'Search in all notes', hint: keys('Mod+Shift+F'), run: () => { setLeft(true); setLeftTab('search'); setTimeout(() => searchInput.current?.select(), 0); } },
    { id: 'tags', name: 'Show tags', run: () => { setLeft(true); setLeftTab('tags'); } },
    { id: 'daily-note', name: "Open today's daily note", hint: keys('Mod+D'), run: () => void openDailyNote() },
    { id: 'random-note', name: 'Open random note', run: () => { const list = notesRef.current; if (list.length) void openNote(list[Math.floor(Math.random() * list.length)].path); } },
    { id: 'toggle-reading', name: mode === 'reading' ? 'Edit note' : 'Reading view', hint: keys('Mod+E'), run: () => setMode(m => m === 'reading' ? editModeRef.current : 'reading'), when: !!open },
    { id: 'toggle-source', name: mode === 'source' ? 'Live preview' : 'Source mode', run: () => setMode(m => m === 'source' ? 'live' : 'source'), when: !!open },
    { id: 'toggle-left', name: left ? 'Hide left sidebar' : 'Show left sidebar', hint: keys('Mod+Shift+L'), run: () => setLeft(v => !v) },
    { id: 'toggle-right', name: right ? 'Hide right sidebar' : 'Show right sidebar', hint: keys('Mod+Shift+R'), run: () => setRight(v => !v) },
    { id: 'outline', name: 'Show outline', run: () => { setRight(true); setRightTab('outline'); } },
    { id: 'backlinks', name: 'Show backlinks', run: () => { setRight(true); setRightTab('backlinks'); } },
    { id: 'back', name: 'Back', hint: isMac ? '⌃⌥←' : 'Ctrl+Alt+←', run: () => go(-1) },
    { id: 'forward', name: 'Forward', hint: isMac ? '⌃⌥→' : 'Ctrl+Alt+→', run: () => go(1) },
    { id: 'export-pdf', name: 'Export to PDF', hint: keys('Mod+Shift+E'), run: () => openPdf('pdf'), when: !!open },
    { id: 'export-docx', name: 'Export to Word', run: () => openPdf('docx'), when: !!open },
    { id: 'format', name: 'Document format', run: openFormat, when: !!open },
    { id: 'insert-image', name: 'Insert image from computer', run: () => void insertImage(), when: editing },
    { id: 'rename', name: 'Rename note', run: () => setFocusTitle(n => n + 1), when: !!open },
    { id: 'reveal', name: 'Show in file manager', run: () => void (open ? api.reveal(open) : api.revealVault()).catch(fail) },
    { id: 'delete', name: 'Delete note', run: () => setConfirmTrash(open), when: !!open },
    { id: 'bold', name: 'Bold', hint: keys('Mod+B'), run: editorCommand(editorCommands.bold), when: editing },
    { id: 'italic', name: 'Italic', hint: keys('Mod+I'), run: editorCommand(editorCommands.italic), when: editing },
    { id: 'underline', name: 'Underline', hint: keys('Mod+U'), run: editorCommand(editorCommands.underline), when: editing },
    ...(['left', 'center', 'right', 'justify'] as const).map(value => ({ id: `align-${value}`, name: `Align ${value}`, hint: keys(`Mod+Alt+${{ left: 'L', center: 'E', right: 'R', justify: 'J' }[value]}`), run: editorCommand(editorCommands.align(value)), when: editing })),
    { id: 'strike', name: 'Strikethrough', hint: keys('Mod+Shift+X'), run: editorCommand(editorCommands.strike), when: editing },
    { id: 'highlight', name: 'Highlight', hint: keys('Mod+Shift+H'), run: editorCommand(editorCommands.highlight), when: editing },
    { id: 'code', name: 'Inline code', hint: keys('Mod+`'), run: editorCommand(editorCommands.code), when: editing },
    { id: 'link', name: 'Insert link', hint: keys('Mod+K'), run: editorCommand(editorCommands.link), when: editing },
    { id: 'bullet', name: 'Bullet list', hint: keys('Mod+Shift+8'), run: editorCommand(editorCommands.bullet), when: editing },
    { id: 'number', name: 'Numbered list', hint: keys('Mod+Shift+7'), run: editorCommand(editorCommands.number), when: editing },
    { id: 'task', name: 'Task list', hint: keys('Mod+L'), run: editorCommand(editorCommands.task), when: editing },
    { id: 'quote', name: 'Quote', hint: keys('Mod+Shift+.'), run: editorCommand(editorCommands.quote), when: editing },
    ...[1, 2, 3].map(level => ({ id: `heading-${level}`, name: `Heading ${level}`, run: editorCommand(editorCommands.heading(level)), when: editing })),
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
          if (!dirty.current.has(path)) {
            setTabs(list => list.map(t => t.path === path ? { ...t, path: null } : t));
            if (openRef.current === path) await showPath(null);
          }
          continue;
        }
        if (dirty.current.has(path)) continue;
        const value = await api.read(path).catch(() => null);
        if (value === null || notesRef.current.find(n => n.path === path)?.text === value) continue;
        updateNote(path, value);
        if (openRef.current === path) setText(value);
      }
    } catch { /* the next change repeats the refresh */ }
  }), [showPath, updateNote]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = isMac ? event.metaKey : event.ctrlKey;
      if (!meta || event.altKey) return;
      const key = event.key.toLowerCase();
      const run = (id: string) => { event.preventDefault(); commandsRef.current.find(c => c.id === id)?.run(); };
      if (key === 'o' && !event.shiftKey) run('quick-switcher');
      else if (key === 'p' && !event.shiftKey) run('command-palette');
      else if (key === 'n' && !event.shiftKey) run('new-note');
      else if (key === 't' && !event.shiftKey) run('new-tab');
      else if (key === 'w' && !event.shiftKey) run('close-tab');
      else if (key === 'd' && !event.shiftKey) run('daily-note');
      else if (key === 'tab') run(event.shiftKey ? 'previous-tab' : 'next-tab');
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
    openInTab: path => void openNote(path, { newTab: true }),
    move: (path, folder) => void moveEntry(path, folder),
    createNote: folder => void createNote(folder),
    createFolder: folder => void createFolder(folder),
    rename: (path, name) => void renameEntry(path, name),
    trash: path => setConfirmTrash(path),
    reveal: path => void (path ? api.reveal(path) : api.revealVault()).catch(fail),
  }), [createFolder, createNote, fail, moveEntry, openNote, renameEntry]);
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
  const platformClass = `${isMac ? 'is-mac' : ''} ${isWindows ? 'is-win' : ''}`;

  if (!info) return <div className="app-loading" />;
  if (!info.vault) return <TooltipProvider delayDuration={400}><div className={`app is-picker ${platformClass}`}><VaultPicker recent={info.recent} error={error} onChoose={create => void chooseVault(create)} onOpen={path => api.openVault(path).then(loadVault).catch(fail)} onForget={path => api.forgetVault(path).then(setInfo).catch(fail)} /></div></TooltipProvider>;

  const canGoBack = !!current && current.history.slice(0, current.index).some(p => notes.some(n => n.path === p));
  const canGoForward = !!current && current.history.slice(current.index + 1).some(p => notes.some(n => n.path === p));
  return <TooltipProvider delayDuration={400}><div className={`app ${platformClass} ${left ? '' : 'left-collapsed'} ${right ? '' : 'right-collapsed'}`} style={{ '--left-width': left ? `${leftWidth}px` : '0px', '--right-width': right ? '280px' : '0px' } as React.CSSProperties}>
    <div className="titlebar-left" hidden={!left}>
      <IconButton label="Files" active={leftTab === 'files'} onClick={() => setLeftTab('files')}><Files size={17} /></IconButton>
      <IconButton label={`Search (${keys('Mod+Shift+F')})`} active={leftTab === 'search'} onClick={() => { setLeftTab('search'); setTimeout(() => searchInput.current?.focus(), 0); }}><SearchIcon size={17} /></IconButton>
      <IconButton label="Tags" active={leftTab === 'tags'} onClick={() => setLeftTab('tags')}><Hash size={17} /></IconButton>
      <span className="titlebar-space" />
      <IconButton label={`Hide sidebar (${keys('Mod+Shift+L')})`} onClick={() => setLeft(false)}><PanelLeft size={17} /></IconButton>
    </div>
    {left && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onMouseDown={startResize} />}
    <div className="tab-strip" role="tablist" aria-label="Open notes">
      {!left && <IconButton label={`Show sidebar (${keys('Mod+Shift+L')})`} onClick={() => setLeft(true)}><PanelLeft size={17} /></IconButton>}
      <IconButton label="Back" disabled={!canGoBack} onClick={() => go(-1)}><ArrowLeft size={16} /></IconButton>
      <IconButton label="Forward" disabled={!canGoForward} onClick={() => go(1)}><ArrowRight size={16} /></IconButton>
      <div className="tabs">
        {tabs.map(tab => { const title = tab.path ? noteName(tab.path) : 'New tab'; return <div key={tab.id} role="tab" aria-selected={tab.id === activeTab} tabIndex={-1} className={`tab ${tab.id === activeTab ? 'is-active' : ''}`} title={tab.path || undefined}
          onClick={() => void selectTab(tab.id)} onAuxClick={e => { if (e.button === 1) { e.preventDefault(); void closeTab(tab.id); } }}>
          <span className="tab-title">{title}</span>
          <button type="button" className="tab-close" aria-label={`Close ${title}`} onClick={e => { e.stopPropagation(); void closeTab(tab.id); }}><X size={13} /></button>
        </div>; })}
        <IconButton label={`New tab (${keys('Mod+T')})`} onClick={() => void newTab()}><Plus size={16} /></IconButton>
      </div>
      {!right && <IconButton label={`Show right sidebar (${keys('Mod+Shift+R')})`} onClick={() => setRight(true)}><PanelRight size={17} /></IconButton>}
    </div>
    <div className="titlebar-right" hidden={!right}>
      <IconButton label="Outline" active={rightTab === 'outline'} onClick={() => setRightTab('outline')}><ListTree size={17} /></IconButton>
      <IconButton label="Backlinks" active={rightTab === 'backlinks'} onClick={() => setRightTab('backlinks')}><Link2 size={17} /></IconButton>
      <IconButton label="Format" active={rightTab === 'format'} onClick={() => setRightTab('format')}><SlidersHorizontal size={17} /></IconButton>
      <span className="titlebar-space" />
      <IconButton label={`Hide right sidebar (${keys('Mod+Shift+R')})`} onClick={() => setRight(false)}><PanelRight size={17} /></IconButton>
    </div>

    <aside className={`sidebar sidebar-left ${left ? '' : 'is-collapsed'}`} aria-label="Left sidebar" aria-hidden={!left}>
      {leftTab === 'files' ? <FileTree vaultName={info.vault.name} tree={tree} openPath={open} expanded={expanded} toggle={toggleFolder} collapseAll={() => setExpanded(new Set())} actions={treeActions} renaming={renaming} setRenaming={setRenaming} />
        : leftTab === 'tags' ? <TagsPane tags={tags} onSelect={openTag} />
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
    <main className="workspace">
      {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => void flush().then(() => setError('')).catch(() => {})}>Retry</button><button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button></div>}
      {open ? <NoteView path={open} text={text} mode={mode} resolve={resolve} format={format} host={host} editorRef={editorRef} articleRef={articleRef} focusTitle={focusTitle} justRenamed={renamedRef.current === open}
        onRename={name => renameEntry(open, name)} onToggleReading={() => setMode(m => m === 'reading' ? editModeRef.current : 'reading')} onToggleSource={() => setMode(m => m === 'source' ? 'live' : 'source')}
        onOpenFormat={openFormat}
        onExport={() => openPdf('pdf')} onExportDocx={() => openPdf('docx')} onReveal={() => void api.reveal(open).catch(fail)} onTrash={() => setConfirmTrash(open)} onOpenLink={openLink} onOpenTag={openTag} onOpenExternal={openExternal} />
        : <div className="empty-state">
          <p className="empty-title">No note is open</p>
          <div className="empty-actions">
            <button type="button" onClick={() => void createNote('')}>New note<kbd>{keys('Mod+N')}</kbd></button>
            <button type="button" onClick={() => { setPaletteQuery(''); setPalette('files'); }}>Go to note<kbd>{keys('Mod+O')}</kbd></button>
            <button type="button" onClick={() => void openDailyNote()}>Today's daily note<kbd>{keys('Mod+D')}</kbd></button>
            <button type="button" onClick={() => { setPaletteQuery(''); setPalette('commands'); }}>Command palette<kbd>{keys('Mod+P')}</kbd></button>
            {tabs.length > 1 && <button type="button" onClick={() => void closeTab(activeTab)}>Close tab<kbd>{keys('Mod+W')}</kbd></button>}
          </div>
        </div>}
      {open && <div className="status-bar" role="status" aria-live="off"><span>{counts.words.toLocaleString()} {counts.words === 1 ? 'word' : 'words'}</span><span>{counts.characters.toLocaleString()} {counts.characters === 1 ? 'character' : 'characters'}</span></div>}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
    <aside className={`sidebar sidebar-right ${right ? '' : 'is-collapsed'}`} aria-label="Right sidebar" aria-hidden={!right}>
      {!open ? <div className="pane"><p className="pane-empty">Open a note to see its {rightTab}.</p></div>
        : rightTab === 'format' ? <FormatPane format={format} onChange={setFormat} onReset={() => setFormat(DEFAULT_FORMAT)} />
        : rightTab === 'outline' ? <OutlinePane headings={headings} onSelect={(index, line) => { if (mode === 'reading') articleRef.current?.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' }); else editorRef.current?.goToLine(line); }} />
          : <BacklinksPane links={links} onOpen={(path, line) => void openNote(path, { line })} />}
    </aside>

    <Palette open={palette === 'files'} title="Quick switcher" placeholder="Find or create a note…" items={paletteItems} query={paletteQuery} onQuery={setPaletteQuery} onClose={() => setPalette(null)} empty="No notes found" />
    <Palette open={palette === 'commands'} title="Command palette" placeholder="Select a command…" items={paletteItems} query={paletteQuery} onQuery={setPaletteQuery} onClose={() => setPalette(null)} empty="No commands found" />
    <Dialog open={pdfOpen} onOpenChange={setPdfOpen} title={exportKind === 'docx' ? 'Export to Word' : 'Export to PDF'} description={open ? noteName(open) : ''}>
      <form className="form" onSubmit={e => { e.preventDefault(); void exportPdf(); }}>
        <label>Format<select value={exportKind} onChange={e => setExportKind(e.target.value as 'pdf' | 'docx')}><option value="pdf">PDF</option><option value="docx">Word (.docx)</option></select></label>
        <label>Page size<select value={pdf.pageSize} onChange={e => setPdf({ ...pdf, pageSize: e.target.value as PdfOptions['pageSize'] })}><option>Letter</option><option>A4</option><option>Legal</option></select></label>
        <label>Margins<select value={pdf.margin} onChange={e => setPdf({ ...pdf, margin: Number(e.target.value) })}>{[...new Set([0, 0.5, 0.75, 1, 1.25, 1.5, pdf.margin])].sort((a, b) => a - b).map(margin => <option key={margin} value={margin}>{margin === 0 ? 'None' : `${margin} in`}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={pdf.pageNumbers} onChange={e => setPdf({ ...pdf, pageNumbers: e.target.checked })} />Page numbers</label>
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
