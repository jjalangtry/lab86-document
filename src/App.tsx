import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, X } from 'lucide-react';
import type { EditorView } from '@codemirror/view';
import type { NoteEditor } from './editor';
import { backlinks as findBacklinks, countWords, folderOf, fuzzyScore, isNotePath, noteName, noteStem, outline, renderMarkdown, searchNotes, parseWiki, tagCounts, WIKI_PATTERN } from './markdown';
import { NoteView } from './NoteView';
import { DEFAULT_FORMAT, applyFormat, formatOf, parseFrontmatter, stripFrontmatter, type DocumentFormat } from './frontmatter';
import { Palette, type PaletteItem } from './Palette';
import { BacklinksPane, FormatPane, OutgoingLinksPane, OutlinePane, type OutgoingLink } from './RightPanel';
import { SettingsDialog } from './SettingsDialog';
import { fillTemplate, loadSettings, saveSettings, type Settings as AppSettings } from './settings';
import { SelectionToolbar } from './SelectionToolbar';
import { BookmarksPane, FileTree, SearchPane, TagsPane, type TreeActions } from './Sidebar';
import { LeftTitleBar, Ribbon, RightTitleBar, TabStrip } from './Chrome';
import { buildCommands, hotkey, type Command } from './commands';
import { errorMessage, flatten, isEditablePath, useVaultStore } from './store/vault';
import { GRAPH, tabKind, useTabs } from './store/tabs';
import { useWorkspaceStore, type Workspace } from './store/workspace';
import type { Mode, PdfOptions, Theme, VaultInfo } from './types';
import { Dialog, TooltipProvider, isMac, keys } from './ui';
import { VaultPicker } from './VaultPicker';
import type { CanvasViewState } from './CanvasView';

// The graph and the canvas load on first use. They are not needed to read a note.
const GraphView = lazy(() => import('./GraphView').then(m => ({ default: m.GraphView })));
const CanvasView = lazy(() => import('./CanvasView').then(m => ({ default: m.CanvasView })));

const api = window.vault;
const isWindows = api.platform === 'win32';
const HELP_URL = 'https://github.com/jjalangtry/lab86-document#readme';
export const APP_VERSION = '0.4.1';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const stored = (key: string, fallback: string) => localStorage.getItem(key) ?? fallback;
const loading = <div className="canvas-loading">Loading…</div>;

export default function App() {
  const [error, setError] = useState('');
  const fail = useCallback((e: unknown) => { setError(errorMessage(e)); void api.log('error', errorMessage(e)); }, []);
  const workspace = useWorkspaceStore();
  const vault = useVaultStore({ onError: fail, beforeClose: workspace.flush });
  const { info, tree, notes, notesRef, allPaths, resolve } = vault;

  const [text, setText] = useState('');
  const [mode, setModeState] = useState<Mode>(() => (['live', 'source', 'reading'].includes(stored('document.mode', 'live')) ? stored('document.mode', 'live') : 'live') as Mode);
  const [left, setLeftState] = useState(true);
  const [right, setRightState] = useState(false);
  const [leftTab, setLeftTabState] = useState<Workspace['leftTab']>('files');
  const [rightTab, setRightTabState] = useState<Workspace['rightTab']>('outline');
  const [leftWidth, setLeftWidthState] = useState(260);
  const [expanded, setExpandedState] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarksState] = useState<string[]>([]);
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [palette, setPalette] = useState<null | 'files' | 'commands' | 'templates' | 'pick'>(null);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [exportKind, setExportKind] = useState<'pdf' | 'docx'>('pdf');
  const [pdf, setPdf] = useState<PdfOptions>({ ...DEFAULT_FORMAT, pageSize: 'Letter', landscape: false, includeTitle: true });
  const [confirmTrash, setConfirmTrash] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [focusTitle, setFocusTitle] = useState(0);
  const [busy, setBusy] = useState(false);
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('dark');

  const editorRef = useRef<NoteEditor | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const openRef = useRef<string | null>(null);
  const renamedRef = useRef<string | null>(null);
  const pickResolver = useRef<((path: string | null) => void) | null>(null);
  const editModeRef = useRef<'live' | 'source'>(mode === 'source' ? 'source' : 'live');
  const commandsRef = useRef<Command[]>([]);
  const settingsRef = useRef(settings); settingsRef.current = settings;

  // Workspace-backed setters. Each one also persists to the vault.
  const setLeft = useCallback((value: boolean | ((v: boolean) => boolean)) => setLeftState(v => { const next = typeof value === 'function' ? value(v) : value; workspace.update({ left: next }); return next; }), [workspace]);
  const setRight = useCallback((value: boolean | ((v: boolean) => boolean)) => setRightState(v => { const next = typeof value === 'function' ? value(v) : value; workspace.update({ right: next }); return next; }), [workspace]);
  const setLeftTab = useCallback((value: Workspace['leftTab']) => { setLeftTabState(value); workspace.update({ leftTab: value }); }, [workspace]);
  const setRightTab = useCallback((value: Workspace['rightTab']) => { setRightTabState(value); workspace.update({ rightTab: value }); }, [workspace]);
  const setLeftWidth = useCallback((value: number) => { setLeftWidthState(value); workspace.update({ leftWidth: value }); }, [workspace]);
  const setExpanded = useCallback((value: Set<string> | ((v: Set<string>) => Set<string>)) => setExpandedState(v => { const next = typeof value === 'function' ? value(v) : value; workspace.update({ expanded: [...next] }); return next; }), [workspace]);
  const setBookmarks = useCallback((value: string[] | ((v: string[]) => string[])) => setBookmarksState(v => { const next = typeof value === 'function' ? value(v) : value; workspace.update({ bookmarks: next }); return next; }), [workspace]);
  const updateSettings = useCallback((patch: Partial<AppSettings>) => setSettingsState(current => { const next = { ...current, ...patch }; saveSettings(next); return next; }), []);
  const setMode = useCallback((value: Mode | ((current: Mode) => Mode)) => setModeState(current => { const next = typeof value === 'function' ? value(current) : value; if (next !== 'reading') editModeRef.current = next; localStorage.setItem('document.mode', next); return next; }), []);

  // Reads a path and returns the step that shows it. Tabs run that step with their own state change.
  const showPath = useCallback(async (path: string | null): Promise<() => void> => {
    if (!path || path === GRAPH) return () => { openRef.current = null; renamedRef.current = null; setText(''); };
    const value = await vault.read(path);
    return () => {
      openRef.current = path; renamedRef.current = null; setText(value);
      workspace.update({ lastOpen: path, recent: [path, ...workspace.state.current.recent.filter(p => p !== path)].slice(0, 30) });
    };
  }, [vault, workspace]);
  const clearView = useCallback(async () => { (await showPath(null))(); }, [showPath]);
  const tabs = useTabs({ beforeSwitch: vault.flushQuiet, show: showPath, onError: fail });
  useEffect(() => { workspace.update({ tabs: tabs.serialize() }); }, [tabs.tabs, tabs.activeTab, tabs, workspace]);

  const kind = tabKind(tabs.current?.path ?? null);
  const open = kind === 'note' ? tabs.current.path : null;
  const canvasPath = kind === 'canvas' ? tabs.current.path : null;
  const theme = info?.theme || 'system';
  const headings = useMemo(() => outline(text), [text]);
  const counts = useMemo(() => countWords(text), [text]);
  const format = useMemo(() => formatOf(text), [text]);
  const links = useMemo(() => open && right && rightTab === 'backlinks' ? findBacklinks(open, notes, resolve) : [], [open, notes, resolve, right, rightTab]);
  const hits = useMemo(() => left && leftTab === 'search' ? searchNotes(query, notes) : [], [query, notes, left, leftTab]);
  const tags = useMemo(() => right && rightTab === 'tags' ? tagCounts(notes) : [], [notes, right, rightTab]);
  const outgoing = useMemo<OutgoingLink[]>(() => {
    if (!open || !right || rightTab !== 'outgoing') return [];
    const seen = new Map<string, OutgoingLink>();
    for (const match of stripFrontmatter(text).matchAll(WIKI_PATTERN)) {
      const target = parseWiki(match).target;
      if (!target) continue;
      const entry = seen.get(target.toLowerCase()) || { target, resolved: resolve(target, open), count: 0 };
      entry.count++; seen.set(target.toLowerCase(), entry);
    }
    return [...seen.values()];
  }, [open, right, rightTab, text, resolve]);
  const templates = useMemo(() => notes.filter(n => n.path.startsWith(`${settings.templatesFolder}/`)).map(n => n.path).sort(), [notes, settings.templatesFolder]);

  useEffect(() => { document.documentElement.style.setProperty('--text-size', `${settings.textSize}px`); }, [settings.textSize]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const effective = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = effective;
      setEffectiveTheme(effective);
      void api.setChrome(effective).catch(() => {});
    };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  // Renderer errors go to the log file next to the main-process log.
  useEffect(() => {
    const onError = (event: ErrorEvent) => void api.log('error', `${event.message} at ${event.filename}:${event.lineno}`);
    const onRejection = (event: PromiseRejectionEvent) => void api.log('error', `unhandled rejection: ${event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason)}`);
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);

  const loadVault = useCallback(async (next: VaultInfo) => {
    try {
      await workspace.unload();
      openRef.current = null; setText(''); setQuery(''); setError('');
      const loaded = await vault.load(next);
      if (!loaded || !next.vault) { tabs.restore(null, () => false, null); return; }
      const saved = await workspace.load(next.vault.path);
      const known = new Set([...flatten(loaded.tree), GRAPH]);
      setLeftState(saved.left); setRightState(saved.right); setLeftTabState(saved.leftTab); setRightTabState(saved.rightTab); setLeftWidthState(saved.leftWidth);
      setExpandedState(new Set(saved.expanded)); setBookmarksState(saved.bookmarks.filter(p => known.has(p)));
      const fallback = saved.lastOpen && known.has(saved.lastOpen) ? saved.lastOpen : null;
      const first = saved.tabs?.paths?.length ? saved.tabs.paths[Math.min(Math.max(0, saved.tabs.active), saved.tabs.paths.length - 1)] : fallback;
      const apply = await showPath(first && known.has(first) ? first : null);
      tabs.restore(saved.tabs, p => known.has(p), fallback);
      apply();
    } catch (e) { fail(e); }
  }, [fail, showPath, tabs, vault, workspace]);
  useEffect(() => { api.info().then(loadVault).catch(fail); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = useCallback((value: string) => { const path = openRef.current; if (!path) return; setText(value); vault.scheduleSave(path, value); }, [vault]);
  const openNote = useCallback(async (path: string, options: { push?: boolean; newTab?: boolean; line?: number; from?: number; length?: number; heading?: string } = {}) => {
    if (options.newTab || openRef.current !== path) await tabs.open(path, options);
    if (options.line === undefined && options.heading === undefined) return;
    setTimeout(() => {
      const editor = editorRef.current;
      if (options.heading !== undefined) {
        const index = outline(editor?.text() ?? '').findIndex(h => h.text.toLowerCase() === (options.heading as string).toLowerCase());
        if (index < 0) return;
        if (articleRef.current) articleRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ block: 'start' });
        else if (editor) editor.goToLine(outline(editor.text())[index].line);
      } else if (options.line !== undefined && editor) {
        if (options.length) editor.select(options.line, options.from || 0, options.length); else editor.goToLine(options.line);
      }
    }, 0);
  }, [tabs]);

  const createNamed = useCallback(async (name: string, focus = false, text = '', extension: '.md' | '.canvas' = '.md') => {
    try {
      const path = await vault.createFile(name, text, extension);
      if (folderOf(path)) setExpanded(current => new Set([...current, ...folderOf(path).split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))]));
      await openNote(path);
      if (focus) setFocusTitle(n => n + 1);
      setLeftTab('files');
      return path;
    } catch (e) { fail(e); return null; }
  }, [fail, openNote, setExpanded, setLeftTab, vault]);
  const newNoteFolder = () => settingsRef.current.newNoteLocation === 'current' && openRef.current ? folderOf(openRef.current) : '';
  const createNote = useCallback((folder?: string) => { const target = folder ?? newNoteFolder(); return createNamed(target ? `${target}/Untitled` : 'Untitled', true); }, [createNamed]);
  const createCanvas = useCallback(() => { const folder = newNoteFolder(); return createNamed(folder ? `${folder}/Untitled` : 'Untitled', false, '{\n\t"nodes": [],\n\t"edges": []\n}\n', '.canvas'); }, [createNamed]);
  const createFolder = useCallback(async (folder: string) => {
    try { const path = await vault.createFolder(folder); if (folder) setExpanded(current => new Set([...current, folder])); setRenaming(path); setLeft(true); setLeftTab('files'); } catch (e) { fail(e); }
  }, [fail, setExpanded, setLeft, setLeftTab, vault]);
  const openGraph = useCallback(async () => { const existing = tabs.findByPath(GRAPH); if (existing) await tabs.select(existing.id); else await tabs.open(GRAPH, { newTab: true }); }, [tabs]);
  const openDailyNote = useCallback(async () => {
    const path = `${settingsRef.current.dailyFolder ? `${settingsRef.current.dailyFolder}/` : ''}${today()}.md`;
    if (notesRef.current.some(n => n.path === path)) await openNote(path); else await createNamed(path, false, `# ${today()}\n\n`);
  }, [createNamed, notesRef, openNote]);
  const insertTemplate = useCallback((path: string) => {
    const note = notesRef.current.find(n => n.path === path), editor = editorRef.current;
    if (!note || !editor || !openRef.current) return;
    editor.insertText(fillTemplate(note.text, noteName(openRef.current)), parseFrontmatter(editor.text())?.end ?? 0);
  }, [notesRef]);
  const pickNote = useCallback(() => new Promise<string | null>(resolve => { pickResolver.current = resolve; setPaletteQuery(''); setPalette('pick'); }), []);
  const toggleBookmark = useCallback((path: string) => setBookmarks(list => list.includes(path) ? list.filter(p => p !== path) : [...list, path]), [setBookmarks]);

  const relocate = useCallback(async (path: string, target: string) => {
    try {
      const moved = await vault.relocate(path, target);
      if (!moved) return;
      const wasOpen = openRef.current;
      if (wasOpen && moved(wasOpen) !== wasOpen) { const next = moved(wasOpen); editorRef.current?.rename(wasOpen, next); openRef.current = next; renamedRef.current = next; workspace.update({ lastOpen: next }); }
      else if (isEditablePath(path)) editorRef.current?.rename(path, moved(path));
      tabs.remap(moved); setBookmarks(list => list.map(moved)); setExpanded(current => new Set([...current].map(moved)));
    } catch (e) { fail(e); await vault.refresh(true).catch(() => {}); }
  }, [fail, setBookmarks, setExpanded, tabs, vault, workspace]);
  const renameEntry = useCallback((path: string, name: string) => relocate(path, `${folderOf(path) ? `${folderOf(path)}/` : ''}${name}${isNotePath(path) ? '.md' : path.endsWith('.canvas') ? '.canvas' : ''}`), [relocate]);
  const moveEntry = useCallback((path: string, folder: string) => relocate(path, `${folder ? `${folder}/` : ''}${path.split('/').pop()}`), [relocate]);
  const trashEntry = useCallback(async (path: string) => {
    try {
      const gone = await vault.trash(path);
      editorRef.current?.forget(path);
      tabs.drop(gone); setBookmarks(list => list.filter(p => !gone(p)));
      if (openRef.current && gone(openRef.current)) await clearView();
    } catch (e) { fail(e); }
  }, [clearView, fail, setBookmarks, tabs, vault]);
  useEffect(() => vault.onDiskChange(async change => {
    if (change.reset) { const path = openRef.current; if (!path) return; const value = notesRef.current.find(n => n.path === path)?.text; if (value === undefined && isNotePath(path)) { tabs.drop(p => p === path); await clearView(); } else if (value !== undefined) setText(value); return; }
    for (const path of change.removed) { tabs.drop(p => p === path); if (openRef.current === path) await clearView(); }
    for (const [path, value] of change.updated) if (openRef.current === path) setText(value);
  }), [clearView, notesRef, tabs, vault]);

  const openLink = useCallback((target: string, heading?: string, newTab = false) => {
    const [name, fragment] = target.split('#');
    const resolved = name ? resolve(name, openRef.current || undefined) : openRef.current;
    if (resolved && isNotePath(resolved)) void openNote(resolved, { heading: heading ?? fragment, newTab });
    else if (resolved) void api.reveal(resolved).catch(fail);
    else if (name) void createNamed(name);
  }, [createNamed, fail, openNote, resolve]);
  const openTag = useCallback((tag: string) => { setLeft(true); setLeftTab('search'); setQuery(`#${tag}`); }, [setLeft, setLeftTab]);
  const openExternal = useCallback((url: string) => { void api.openExternal(url).catch(fail); }, [fail]);
  const saveImage = useCallback(async (file: File) => {
    try { const path = await api.saveAttachment(file.name || `Pasted image ${Date.now()}.png`, new Uint8Array(await file.arrayBuffer()), settingsRef.current.attachmentsFolder); await vault.refresh(); return path; }
    catch (e) { fail(e); return null; }
  }, [fail, vault]);
  const insertImage = useCallback(async () => {
    try {
      const path = await api.importImage(settingsRef.current.attachmentsFolder);
      if (!path) return;
      await vault.refresh();
      editorRef.current?.insertText(`![[${path}]]`);
    } catch (e) { fail(e); }
  }, [fail, vault]);
  // Format changes rewrite only the frontmatter block through the editor, so undo works.
  const setFormat = useCallback((patch: Partial<DocumentFormat>) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const current = view.state.doc.toString(), next = applyFormat(current, patch);
    if (next === current) return;
    const oldEnd = parseFrontmatter(current)?.end ?? 0, newEnd = parseFrontmatter(next)?.end ?? 0;
    view.dispatch({ changes: { from: 0, to: oldEnd, insert: next.slice(0, newEnd) } });
  }, []);
  const openExport = useCallback((kind: 'pdf' | 'docx') => {
    const current = formatOf(editorRef.current?.text() ?? '');
    setPdf(previous => ({ ...previous, pageSize: current.paper, margin: current.margin, pageNumbers: current.pageNumbers }));
    setExportKind(kind); setPdfOpen(true);
  }, []);
  const exportNote = useCallback(async () => {
    const path = openRef.current;
    if (!path || busy) return;
    setBusy(true);
    try {
      await vault.flush();
      const value = notesRef.current.find(n => n.path === path)?.text ?? '';
      const current = formatOf(value);
      const options = { ...pdf, font: current.font, size: current.size, lineHeight: current.lineHeight, align: current.align, indent: current.indent };
      let result: { fileName: string } | null;
      if (exportKind === 'docx') {
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
  }, [busy, exportKind, fail, notesRef, pdf, resolve, vault]);
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
    return { title: noteName(resolved), html: renderMarkdown(stripFrontmatter(note.text).slice(0, 2500), resolved, resolve) || '<p class="pane-empty">Empty note</p>' };
  }, [notesRef, resolve]);
  const openFormat = useCallback(() => { setRight(true); setRightTab('format'); }, [setRight, setRightTab]);
  const hostValue = { resolve: (target: string) => resolve(target, openRef.current || undefined), noteNames: () => notesRef.current.map(n => noteStem(n.path)).sort(), openLink, openExternal, openTag, saveImage, onChange, openFormat, mountToolbar, preview };
  const hostRef = useRef(hostValue); hostRef.current = hostValue;
  const host = useCallback(() => hostRef.current, []);
  const setTheme = useCallback((value: Theme) => { vault.setInfo(current => current ? { ...current, theme: value } : current); void api.setTheme(value).catch(fail); }, [fail, vault]);
  const chooseVault = useCallback(async (create: boolean) => { try { await vault.flushQuiet(); const next = await api.chooseVault(create); if (next) await loadVault(next); } catch (e) { fail(e); } }, [fail, loadVault, vault]);
  const switchVault = useCallback((path: string) => void vault.flushQuiet().then(() => api.openVault(path)).then(loadVault).catch(fail), [fail, loadVault, vault]);
  const closeVault = useCallback(() => void vault.flushQuiet().then(() => api.closeVault()).then(loadVault).catch(fail), [fail, loadVault, vault]);
  const exists = useCallback((path: string) => path === GRAPH || allPaths.includes(path), [allPaths]);
  const editing = !!open && mode !== 'reading';
  const inTextField = () => { const active = document.activeElement; return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement; };

  const commands = buildCommands({
    open, editing, mode, left, right, bookmarked: !!open && bookmarks.includes(open), readableWidth: settings.readableWidth, editorView: () => editorRef.current?.view ?? null,
    actions: {
      createNote: () => void createNote(), createFolder: () => void createFolder(''), createCanvas: () => void createCanvas(), openGraph: () => void openGraph(),
      newTab: () => void tabs.create(), closeTab: () => void tabs.close(tabs.activeRef.current), cycleTab: tabs.cycle, back: () => tabs.go(-1, exists), forward: () => tabs.go(1, exists),
      palette: k => { setPaletteQuery(''); setPalette(k); }, search: () => { setLeft(true); setLeftTab('search'); setTimeout(() => searchInput.current?.select(), 0); },
      dailyNote: () => void openDailyNote(), randomNote: () => { const list = notesRef.current; if (list.length) void openNote(list[Math.floor(Math.random() * list.length)].path); },
      toggleReading: () => setMode(m => m === 'reading' ? editModeRef.current : 'reading'), toggleSource: () => setMode(m => m === 'source' ? 'live' : 'source'),
      toggleLeft: () => setLeft(v => !v), toggleRight: () => setRight(v => !v), showLeft: t => { setLeft(true); setLeftTab(t); }, showRight: t => { setRight(true); setRightTab(t); },
      toggleBookmark: () => { if (open) toggleBookmark(open); }, settings: () => setSettingsOpen(true), help: () => void api.openExternal(HELP_URL).catch(fail), logs: () => void api.openLogs().catch(fail),
      undo: () => { if (inTextField()) document.execCommand('undo'); else editorRef.current?.undo(); }, redo: () => { if (inTextField()) document.execCommand('redo'); else editorRef.current?.redo(); },
      find: () => { if (mode !== 'reading') { editorRef.current?.openSearch(); editorRef.current?.view.focus(); } },
      exportPdf: () => openExport('pdf'), exportDocx: () => openExport('docx'), insertImage: () => void insertImage(), rename: () => setFocusTitle(n => n + 1),
      reveal: () => void (open ? api.reveal(open) : api.revealVault()).catch(fail), trash: () => setConfirmTrash(open),
      theme: setTheme, toggleReadableWidth: () => updateSettings({ readableWidth: !settings.readableWidth }), openVault: () => void chooseVault(false), closeVault,
    },
  });
  commandsRef.current = commands;
  const run = useCallback((id: string) => { const command = commandsRef.current.find(c => c.id === id); if (command && command.when !== false) command.run(); }, []);
  useEffect(() => api.onCommand(run), [run]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { const id = hotkey(event); if (id) { event.preventDefault(); run(id); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const treeActions: TreeActions = useMemo(() => ({
    open: path => void openNote(path), openInTab: path => void openNote(path, { newTab: true }), move: (path, folder) => void moveEntry(path, folder),
    createNote: folder => void createNote(folder), createFolder: folder => void createFolder(folder), rename: (path, name) => void renameEntry(path, name),
    bookmark: toggleBookmark, isBookmarked: path => bookmarks.includes(path), trash: path => setConfirmTrash(path), reveal: path => void (path ? api.reveal(path) : api.revealVault()).catch(fail),
  }), [bookmarks, createFolder, createNote, fail, moveEntry, openNote, renameEntry, toggleBookmark]);
  const toggleFolder = useCallback((path: string) => setExpanded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; }), [setExpanded]);

  const paletteItems: PaletteItem[] = useMemo(() => {
    const q = paletteQuery.trim();
    const ranked = <T,>(items: T[], label: (item: T) => string) => items.map(item => ({ item, score: fuzzyScore(q, label(item)) })).filter(x => x.score !== null).sort((a, b) => (b.score as number) - (a.score as number)).map(x => x.item);
    if (palette === 'commands') return ranked(commands.filter(c => c.when !== false), c => c.name).map(c => ({ id: c.id, label: c.name, hint: c.hint, run: c.run }));
    if (palette === 'templates') return ranked(templates, noteName).map(p => ({ id: p, label: noteName(p), detail: folderOf(p), run: () => insertTemplate(p) }));
    const paths = notes.map(n => n.path);
    if (palette === 'pick') return ranked(paths, noteStem).slice(0, 60).map(p => ({ id: p, label: noteName(p), detail: folderOf(p) || undefined, run: () => { pickResolver.current?.(p); pickResolver.current = null; } }));
    if (palette !== 'files') return [];
    let ordered: string[];
    if (q) ordered = ranked(paths, noteStem).slice(0, 60);
    else { const recent = workspace.state.current.recent.filter(p => paths.includes(p)); ordered = [...recent, ...paths.filter(p => !recent.includes(p)).sort()].slice(0, 60); }
    const items: PaletteItem[] = ordered.map(p => ({ id: p, label: noteName(p), detail: folderOf(p) || undefined, run: () => void openNote(p) }));
    if (q && !paths.some(p => noteStem(p).toLowerCase() === q.toLowerCase() || noteName(p).toLowerCase() === q.toLowerCase())) items.push({ id: '__create', label: `Create "${q}"`, detail: 'New note', hint: 'Enter', run: () => void createNamed(q) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, paletteQuery, notes, templates]);
  const closePalette = useCallback(() => { setPalette(null); if (pickResolver.current) { pickResolver.current(null); pickResolver.current = null; } }, []);
  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX, startWidth = leftWidth;
    const move = (e: MouseEvent) => setLeftWidth(Math.min(480, Math.max(200, startWidth + e.clientX - startX)));
    const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); document.body.classList.remove('is-resizing'); };
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);
  };
  const saveCanvasView = useCallback((path: string, view: CanvasViewState) => workspace.update({ canvasViews: { ...workspace.state.current.canvasViews, [path]: view } }), [workspace]);
  const platformClass = `${isMac ? 'is-mac' : ''} ${isWindows ? 'is-win' : ''}`;

  if (!info) return <div className="app-loading" />;
  if (!info.vault) return <TooltipProvider delayDuration={400}><div className={`app is-picker ${platformClass}`}><VaultPicker recent={info.recent} error={error} onChoose={create => void chooseVault(create)} onOpen={path => api.openVault(path).then(loadVault).catch(fail)} onForget={path => api.forgetVault(path).then(vault.setInfo).catch(fail)} /></div></TooltipProvider>;

  return <TooltipProvider delayDuration={400}><div className={`app ${platformClass} ${left ? '' : 'left-collapsed'} ${right ? '' : 'right-collapsed'}`} style={{ '--left-width': left ? `${leftWidth}px` : '0px', '--right-width': right ? '280px' : '0px' } as React.CSSProperties}>
    <div className="corner" />
    <Ribbon info={info} graphOpen={kind === 'graph'} editing={editing} run={run} onOpenVault={() => void chooseVault(false)} onCreateVault={() => void chooseVault(true)} onSwitchVault={switchVault} onRevealVault={() => void api.revealVault().catch(fail)} onCloseVault={closeVault} />
    {left && <LeftTitleBar tab={leftTab} onTab={tab => { setLeftTab(tab); if (tab === 'search') setTimeout(() => searchInput.current?.focus(), 0); }} onHide={() => setLeft(false)} />}
    {left && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onMouseDown={startResize} />}
    <TabStrip tabs={tabs.tabs} activeTab={tabs.activeTab} left={left} right={right} canGoBack={tabs.canGo(-1, exists)} canGoForward={tabs.canGo(1, exists)} onSelect={id => void tabs.select(id)} onClose={id => void tabs.close(id)} onNew={() => void tabs.create()} onBack={() => tabs.go(-1, exists)} onForward={() => tabs.go(1, exists)} onShowLeft={() => setLeft(true)} onShowRight={() => setRight(true)} />
    {right && <RightTitleBar tab={rightTab} onTab={setRightTab} onHide={() => setRight(false)} />}

    <aside className={`sidebar sidebar-left ${left ? '' : 'is-collapsed'}`} aria-label="Left sidebar" aria-hidden={!left}>
      {leftTab === 'files' ? <FileTree vaultName={info.vault.name} tree={tree} openPath={tabs.current?.path ?? null} expanded={expanded} toggle={toggleFolder} collapseAll={() => setExpanded(new Set())} actions={treeActions} renaming={renaming} setRenaming={setRenaming} />
        : leftTab === 'bookmarks' ? <BookmarksPane bookmarks={bookmarks} onOpen={path => void openNote(path)} onRemove={toggleBookmark} />
          : <SearchPane query={query} setQuery={setQuery} hits={hits} inputRef={searchInput} onOpen={(path, line, from, length) => void openNote(path, { line, from, length })} />}
    </aside>
    <main className="workspace">
      {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => void vault.flush().then(() => setError('')).catch(() => {})}>Retry</button><button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button></div>}
      {kind === 'graph' ? <Suspense fallback={loading}><GraphView notes={notes} resolve={resolve} focus={tabs.tabs.find(t => t.id !== tabs.activeTab && t.path && tabKind(t.path) === 'note')?.path ?? null} onOpen={path => void openNote(path, { newTab: true })} /></Suspense>
        : canvasPath ? <Suspense fallback={loading}><CanvasView key={canvasPath} path={canvasPath} text={text} onChange={onChange} resolve={resolve} notes={notes} onOpenNote={path => void openNote(path, { newTab: true })} pickNote={pickNote} theme={effectiveTheme} initialView={workspace.state.current.canvasViews[canvasPath]} onViewChange={view => saveCanvasView(canvasPath, view)} /></Suspense>
        : open ? <NoteView path={open} text={text} mode={mode} resolve={resolve} format={format} spellcheck={settings.spellcheck} lineNumbers={settings.showLineNumbers} readableWidth={settings.readableWidth} host={host} editorRef={editorRef} articleRef={articleRef} focusTitle={focusTitle} justRenamed={renamedRef.current === open}
          onRename={name => renameEntry(open, name)} onToggleReading={() => run('toggle-reading')} onToggleSource={() => run('toggle-source')} onOpenFormat={openFormat}
          onExport={() => openExport('pdf')} onExportDocx={() => openExport('docx')} onReveal={() => void api.reveal(open).catch(fail)} onTrash={() => setConfirmTrash(open)} onOpenLink={openLink} onOpenTag={openTag} onOpenExternal={openExternal} />
        : <div className="empty-state">
          <p className="empty-title">No note is open</p>
          <div className="empty-actions">
            <button type="button" onClick={() => run('new-note')}>New note<kbd>{keys('Mod+N')}</kbd></button>
            <button type="button" onClick={() => run('quick-switcher')}>Go to note<kbd>{keys('Mod+O')}</kbd></button>
            <button type="button" onClick={() => run('daily-note')}>Today's daily note<kbd>{keys('Mod+D')}</kbd></button>
            <button type="button" onClick={() => run('graph')}>Graph view<kbd>{keys('Mod+G')}</kbd></button>
            <button type="button" onClick={() => run('new-canvas')}>New canvas</button>
            <button type="button" onClick={() => run('command-palette')}>Command palette<kbd>{keys('Mod+P')}</kbd></button>
            {tabs.tabs.length > 1 && <button type="button" onClick={() => run('close-tab')}>Close tab<kbd>{keys('Mod+W')}</kbd></button>}
          </div>
        </div>}
      {open && <div className="status-bar" role="status" aria-live="off"><span>{counts.words.toLocaleString()} {counts.words === 1 ? 'word' : 'words'}</span><span>{counts.characters.toLocaleString()} {counts.characters === 1 ? 'character' : 'characters'}</span></div>}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
    <aside className={`sidebar sidebar-right ${right ? '' : 'is-collapsed'}`} aria-label="Right sidebar" aria-hidden={!right}>
      {rightTab === 'tags' ? <TagsPane tags={tags} onSelect={openTag} />
        : !open ? <div className="pane"><p className="pane-empty">Open a note to see its {rightTab === 'outgoing' ? 'outgoing links' : rightTab}.</p></div>
        : rightTab === 'format' ? <FormatPane format={format} onChange={setFormat} onReset={() => setFormat(DEFAULT_FORMAT)} />
        : rightTab === 'outgoing' ? <OutgoingLinksPane links={outgoing} onOpen={(target, resolved) => { if (resolved) void openNote(resolved); else void createNamed(target); }} />
        : rightTab === 'outline' ? <OutlinePane headings={headings} onSelect={(index, line) => { if (mode === 'reading') articleRef.current?.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' }); else editorRef.current?.goToLine(line); }} />
          : <BacklinksPane links={links} onOpen={(path, line) => void openNote(path, { line })} />}
    </aside>

    <Palette open={palette === 'files'} title="Quick switcher" placeholder="Find or create a note…" items={paletteItems} query={paletteQuery} onQuery={setPaletteQuery} onClose={closePalette} empty="No notes found" />
    <Palette open={palette === 'commands'} title="Command palette" placeholder="Select a command…" items={paletteItems} query={paletteQuery} onQuery={setPaletteQuery} onClose={closePalette} empty="No commands found" />
    <Palette open={palette === 'templates'} title="Insert template" placeholder="Select a template…" items={paletteItems} query={paletteQuery} onQuery={setPaletteQuery} onClose={closePalette} empty={`No templates. Add notes to the ${settings.templatesFolder} folder.`} />
    <Palette open={palette === 'pick'} title="Add note to canvas" placeholder="Select a note…" items={paletteItems} query={paletteQuery} onQuery={setPaletteQuery} onClose={closePalette} empty="No notes found" />
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onChange={updateSettings} theme={theme} onTheme={setTheme} mode={mode} onMode={setMode} version={APP_VERSION} onShowLogs={() => void api.openLogs().catch(fail)} />
    <Dialog open={pdfOpen} onOpenChange={setPdfOpen} title={exportKind === 'docx' ? 'Export to Word' : 'Export to PDF'} description={open ? noteName(open) : ''}>
      <form className="form" onSubmit={e => { e.preventDefault(); void exportNote(); }}>
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
