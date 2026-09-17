// A browser stand-in for the Electron preload API. It lets the renderer run in a normal browser
// for design review. Notes live in localStorage. Electron skips this file because window.vault exists.
import type { Entry, Note, Theme, VaultInfo } from './types';

const KEY = 'document.browser-vault';
const SAMPLE: Record<string, string> = {
  'Projects/Garden plan.md': ['# Garden plan', '', "The raised beds go on the south side of the yard. See [[Soil notes]] for the mix and [[Daily/2026-09-16|today's log]] for the delivery time.", '', '## Tasks', '', '- [x] Measure the yard', '- [x] Order lumber from the mill', '- [ ] Build the first two beds', '- [ ] Set up drip irrigation #garden #spring', '', '## Bed layout', '', '| Bed | Size | Crop |', '| --- | --- | --- |', '| A | 4 × 8 ft | Tomatoes |', '| B | 4 × 8 ft | Peppers |', '| C | 4 × 4 ft | Herbs |', '', '> Plant tomatoes after the last frost. The soil should be at least 60 °F.', '', '```js', "const beds = ['A', 'B', 'C'];", 'console.log(beds.length);', '```', ''].join('\n'),
  'Soil notes.md': '# Soil notes\n\nUse one part compost, one part topsoil, and one part coarse sand. Back to [[Garden plan]].\n',
  'Daily/2026-09-16.md': '# 2026-09-16\n\n- Lumber delivery at 14:00\n- Walked the dog\n- Read about [[Garden plan#Bed layout|bed layout]]\n',
  'Reading list.md': '# Reading list\n\n1. *The Hidden Life of Trees*\n2. **Braiding Sweetgrass**\n3. ~~A book I gave up on~~\n',
};

if (!window.vault) {
  type State = { files: Record<string, string>; folders: string[]; theme: Theme; open: boolean };
  const load = (): State => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<State>;
      return { files: saved.files ?? { ...SAMPLE }, folders: saved.folders ?? [], theme: saved.theme ?? 'system', open: true };
    } catch { return { files: { ...SAMPLE }, folders: [], theme: 'system', open: true }; }
  };
  const state: State = load();
  const persist = () => localStorage.setItem(KEY, JSON.stringify({ files: state.files, folders: state.folders, theme: state.theme }));
  const listeners = { changed: new Set<(paths: string[]) => void>(), command: new Set<(name: string) => void>(), close: new Set<() => void>() };
  const info = (): VaultInfo => ({ vault: state.open ? { path: '/Browser preview/Notes', name: 'Notes' } : null, recent: ['/Browser preview/Notes'], theme: state.theme, platform: navigator.platform.includes('Mac') ? 'darwin' : 'linux' });
  const folderOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const notify = (paths: string[]) => { persist(); for (const listener of listeners.changed) listener(paths); };
  const tree = (): Entry[] => {
    const folders = new Set<string>(state.folders);
    for (const path of Object.keys(state.files)) { let folder = folderOf(path); while (folder) { folders.add(folder); folder = folderOf(folder); } }
    const build = (parent: string): Entry[] => {
      const inside = (path: string) => folderOf(path) === parent;
      const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      const folderEntries = [...folders].filter(inside).map(path => ({ name: path.split('/').pop() as string, path, kind: 'folder' as const, children: build(path) })).sort(byName);
      const noteEntries = Object.keys(state.files).filter(inside).map(path => ({ name: path.split('/').pop() as string, path, kind: path.endsWith('.canvas') ? 'canvas' as const : 'note' as const })).sort(byName);
      return [...folderEntries, ...noteEntries];
    };
    return build('');
  };
  const unique = (folder: string, base: string, extension: string) => {
    for (let n = 0; ; n++) {
      const candidate = `${folder ? `${folder}/` : ''}${base}${n ? ` ${n}` : ''}${extension}`;
      const taken = extension ? candidate in state.files : state.folders.includes(candidate) || Object.keys(state.files).some(p => p.startsWith(`${candidate}/`));
      if (!taken) return candidate;
    }
  };
  const wait = () => new Promise<void>(resolve => setTimeout(resolve, 20));
  window.vault = {
    platform: info().platform,
    info: async () => info(),
    setTheme: async theme => { state.theme = theme; persist(); },
    setChrome: async () => {},
    log: async () => {},
    openLogs: async () => {},
    readState: async name => { try { return JSON.parse(localStorage.getItem(`${KEY}:state:${name}`) || 'null'); } catch { return null; } },
    writeState: async (name, value) => { localStorage.setItem(`${KEY}:state:${name}`, JSON.stringify(value)); },
    chooseVault: async () => { state.open = true; return info(); },
    openVault: async () => { state.open = true; return info(); },
    forgetVault: async () => info(),
    closeVault: async () => { state.open = false; return info(); },
    tree: async () => tree(),
    index: async (): Promise<Note[]> => Object.entries(state.files).filter(([path]) => path.endsWith('.md')).map(([path, text]) => ({ path, text })),
    revealVault: async () => {},
    read: async path => { if (!(path in state.files)) throw Error('The note does not exist.'); return state.files[path]; },
    write: async (path, text) => { await wait(); state.files[path] = text; persist(); },
    createNote: async (folder, name = 'Untitled', text = '', extension = '.md') => { const path = unique(folder, name, extension); state.files[path] = text; notify([path]); return path; },
    createFolder: async (folder, name = 'New folder') => { const path = unique(folder, name, ''); state.folders.push(path); notify([path]); return path; },
    rename: async (from, to) => {
      if (to in state.files || state.folders.includes(to)) throw Error('An item with this name exists.');
      const moved = (path: string) => path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
      state.files = Object.fromEntries(Object.entries(state.files).map(([path, text]) => [moved(path), text]));
      state.folders = state.folders.map(moved);
      notify([from, to]); return to;
    },
    trash: async path => { for (const key of Object.keys(state.files)) if (key === path || key.startsWith(`${path}/`)) delete state.files[key]; state.folders = state.folders.filter(f => f !== path && !f.startsWith(`${path}/`)); notify([path]); },
    reveal: async () => {},
    importImage: async () => { throw Error('Images are not available in the browser preview.'); },
    saveAttachment: async () => { throw Error('Images are not available in the browser preview.'); },
    exportPdf: async (title, html) => {
      const page = window.open('', '_blank');
      if (!page) return null;
      page.document.write(`<!doctype html><title>${title.replace(/</g, '&lt;')}</title><style>body{font-family:sans-serif;max-width:720px;margin:40px auto;line-height:1.55}</style><h1>${title.replace(/</g, '&lt;')}</h1>${html}`);
      page.document.close(); page.print();
      return { fileName: `${title}.pdf` };
    },
    exportDocx: async () => { throw Error('Word export is not available in the browser preview.'); },
    openExternal: async url => { window.open(url, '_blank', 'noopener'); },
    closeReady: async () => {},
    closeFailed: async () => {},
    onChanged: callback => { listeners.changed.add(callback); return () => listeners.changed.delete(callback); },
    onCommand: callback => { listeners.command.add(callback); return () => listeners.command.delete(callback); },
    onClose: callback => { listeners.close.add(callback); return () => listeners.close.delete(callback); },
  };
}
