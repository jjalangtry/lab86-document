import type { EditorView } from '@codemirror/view';
import { commands as editorCommands } from './editor';
import { isMac, keys } from './ui';

export type Command = { id: string; name: string; hint?: string; run: () => void; when?: boolean };

// Everything the commands can reach. The app builds this once per render.
export type CommandContext = {
  open: string | null;
  editing: boolean;
  mode: 'live' | 'source' | 'reading';
  left: boolean;
  right: boolean;
  bookmarked: boolean;
  readableWidth: boolean;
  editorView: () => EditorView | null;
  actions: {
    createNote: () => void; createFolder: () => void; createCanvas: () => void; openGraph: () => void;
    newTab: () => void; closeTab: () => void; cycleTab: (delta: number) => void; back: () => void; forward: () => void;
    palette: (kind: 'files' | 'commands' | 'templates') => void; search: () => void; dailyNote: () => void; randomNote: () => void;
    toggleReading: () => void; toggleSource: () => void; toggleLeft: () => void; toggleRight: () => void;
    showLeft: (tab: 'files' | 'search' | 'bookmarks') => void; showRight: (tab: 'backlinks' | 'outgoing' | 'tags' | 'outline' | 'format') => void;
    toggleBookmark: () => void; settings: () => void; help: () => void; logs: () => void;
    undo: () => void; redo: () => void; find: () => void;
    exportPdf: () => void; exportDocx: () => void; insertImage: () => void; rename: () => void; reveal: () => void; trash: () => void;
    theme: (theme: 'system' | 'light' | 'dark') => void; toggleReadableWidth: () => void; openVault: () => void; closeVault: () => void;
  };
};

export function buildCommands(ctx: CommandContext): Command[] {
  const a = ctx.actions;
  const editor = (run: (view: EditorView) => boolean) => () => { const view = ctx.editorView(); if (view && ctx.mode !== 'reading') { run(view); view.focus(); } };
  const editing = ctx.editing;
  const open = !!ctx.open;
  return [
    { id: 'new-note', name: 'New note', hint: keys('Mod+N'), run: a.createNote },
    { id: 'new-folder', name: 'New folder', run: a.createFolder },
    { id: 'new-canvas', name: 'Create new canvas', run: a.createCanvas },
    { id: 'graph', name: 'Open graph view', hint: keys('Mod+G'), run: a.openGraph },
    { id: 'insert-template', name: 'Insert template', run: () => a.palette('templates'), when: editing },
    { id: 'bookmark', name: ctx.bookmarked ? 'Remove bookmark' : 'Bookmark this note', run: a.toggleBookmark, when: open },
    { id: 'bookmarks', name: 'Show bookmarks', run: () => a.showLeft('bookmarks') },
    { id: 'outgoing', name: 'Show outgoing links', run: () => a.showRight('outgoing') },
    { id: 'settings', name: 'Open settings', hint: keys('Mod+,'), run: a.settings },
    { id: 'help', name: 'Open help', run: a.help },
    { id: 'logs', name: 'Show logs folder', run: a.logs },
    { id: 'new-tab', name: 'New tab', hint: keys('Mod+T'), run: a.newTab },
    { id: 'close-tab', name: 'Close tab', hint: keys('Mod+W'), run: a.closeTab },
    { id: 'next-tab', name: 'Next tab', hint: 'Ctrl+Tab', run: () => a.cycleTab(1) },
    { id: 'previous-tab', name: 'Previous tab', hint: 'Ctrl+Shift+Tab', run: () => a.cycleTab(-1) },
    { id: 'undo', name: 'Undo', hint: keys('Mod+Z'), run: a.undo },
    { id: 'redo', name: 'Redo', hint: isMac ? '⇧⌘Z' : 'Ctrl+Y', run: a.redo },
    { id: 'find', name: 'Find in note', hint: keys('Mod+F'), run: a.find, when: open },
    { id: 'quick-switcher', name: 'Open quick switcher', hint: keys('Mod+O'), run: () => a.palette('files') },
    { id: 'search', name: 'Search in all notes', hint: keys('Mod+Shift+F'), run: a.search },
    { id: 'tags', name: 'Show tags', run: () => a.showRight('tags') },
    { id: 'daily-note', name: "Open today's daily note", hint: keys('Mod+D'), run: a.dailyNote },
    { id: 'random-note', name: 'Open random note', run: a.randomNote },
    { id: 'toggle-reading', name: ctx.mode === 'reading' ? 'Edit note' : 'Reading view', hint: keys('Mod+E'), run: a.toggleReading, when: open },
    { id: 'toggle-source', name: ctx.mode === 'source' ? 'Live preview' : 'Source mode', run: a.toggleSource, when: open },
    { id: 'toggle-left', name: ctx.left ? 'Hide left sidebar' : 'Show left sidebar', hint: keys('Mod+Shift+L'), run: a.toggleLeft },
    { id: 'toggle-right', name: ctx.right ? 'Hide right sidebar' : 'Show right sidebar', hint: keys('Mod+Shift+R'), run: a.toggleRight },
    { id: 'outline', name: 'Show outline', run: () => a.showRight('outline') },
    { id: 'backlinks', name: 'Show backlinks', run: () => a.showRight('backlinks') },
    { id: 'back', name: 'Back', hint: isMac ? '⌃⌥←' : 'Ctrl+Alt+←', run: a.back },
    { id: 'forward', name: 'Forward', hint: isMac ? '⌃⌥→' : 'Ctrl+Alt+→', run: a.forward },
    { id: 'export-pdf', name: 'Export to PDF', hint: keys('Mod+Shift+E'), run: a.exportPdf, when: open },
    { id: 'export-docx', name: 'Export to Word', run: a.exportDocx, when: open },
    { id: 'format', name: 'Document format', run: () => a.showRight('format'), when: open },
    { id: 'insert-image', name: 'Insert image from computer', run: a.insertImage, when: editing },
    { id: 'rename', name: 'Rename note', run: a.rename, when: open },
    { id: 'reveal', name: 'Show in file manager', run: a.reveal },
    { id: 'delete', name: 'Delete note', run: a.trash, when: open },
    { id: 'bold', name: 'Bold', hint: keys('Mod+B'), run: editor(editorCommands.bold), when: editing },
    { id: 'italic', name: 'Italic', hint: keys('Mod+I'), run: editor(editorCommands.italic), when: editing },
    { id: 'underline', name: 'Underline', hint: keys('Mod+U'), run: editor(editorCommands.underline), when: editing },
    ...(['left', 'center', 'right', 'justify'] as const).map(value => ({ id: `align-${value}`, name: `Align ${value}`, hint: keys(`Mod+Alt+${{ left: 'L', center: 'E', right: 'R', justify: 'J' }[value]}`), run: editor(editorCommands.align(value)), when: editing })),
    { id: 'strike', name: 'Strikethrough', hint: keys('Mod+Shift+X'), run: editor(editorCommands.strike), when: editing },
    { id: 'highlight', name: 'Highlight', hint: keys('Mod+Shift+H'), run: editor(editorCommands.highlight), when: editing },
    { id: 'code', name: 'Inline code', hint: keys('Mod+`'), run: editor(editorCommands.code), when: editing },
    { id: 'link', name: 'Insert link', hint: keys('Mod+K'), run: editor(editorCommands.link), when: editing },
    { id: 'bullet', name: 'Bullet list', hint: keys('Mod+Shift+8'), run: editor(editorCommands.bullet), when: editing },
    { id: 'number', name: 'Numbered list', hint: keys('Mod+Shift+7'), run: editor(editorCommands.number), when: editing },
    { id: 'task', name: 'Task list', hint: keys('Mod+L'), run: editor(editorCommands.task), when: editing },
    { id: 'quote', name: 'Quote', hint: keys('Mod+Shift+.'), run: editor(editorCommands.quote), when: editing },
    ...[1, 2, 3].map(level => ({ id: `heading-${level}`, name: `Heading ${level}`, run: editor(editorCommands.heading(level)), when: editing })),
    { id: 'theme-system', name: 'Theme: match system', run: () => a.theme('system') },
    { id: 'theme-light', name: 'Theme: light', run: () => a.theme('light') },
    { id: 'theme-dark', name: 'Theme: dark', run: () => a.theme('dark') },
    { id: 'readable-width', name: ctx.readableWidth ? 'Disable readable line length' : 'Enable readable line length', run: a.toggleReadableWidth },
    { id: 'command-palette', name: 'Command palette', hint: keys('Mod+P'), run: () => a.palette('commands') },
    { id: 'open-vault', name: 'Open another vault', run: a.openVault },
    { id: 'close-vault', name: 'Close vault', run: a.closeVault },
  ];
}

// Maps a keyboard event to a command id. Returns null when the key is not a hotkey.
export function hotkey(event: KeyboardEvent): string | null {
  const meta = isMac ? event.metaKey : event.ctrlKey;
  if (!meta || event.altKey) return null;
  const key = event.key.toLowerCase();
  const shift = event.shiftKey;
  if (key === 'tab') return shift ? 'previous-tab' : 'next-tab';
  if (shift) return ({ f: 'search', l: 'toggle-left', r: 'toggle-right', e: 'export-pdf' } as Record<string, string>)[key] ?? null;
  return ({ o: 'quick-switcher', p: 'command-palette', n: 'new-note', t: 'new-tab', w: 'close-tab', d: 'daily-note', g: 'graph', ',': 'settings', e: 'toggle-reading' } as Record<string, string>)[key] ?? null;
}
