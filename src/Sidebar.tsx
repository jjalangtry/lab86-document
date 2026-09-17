import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, FilePlus, FolderPlus, Search as SearchIcon, X } from 'lucide-react';
import type { Entry } from './types';
import { noteName, type SearchHit } from './markdown';
import { ContextItem, ContextMenu, ContextSeparator, IconButton } from './ui';

export type TreeActions = {
  open: (path: string) => void;
  createNote: (folder: string) => void;
  createFolder: (folder: string) => void;
  rename: (path: string, name: string) => void;
  trash: (path: string) => void;
  reveal: (path: string) => void;
};

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return <input ref={ref} className="tree-rename" aria-label="New name" value={value} onChange={e => setValue(e.target.value)}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onCommit(value); } if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
    onBlur={() => onCommit(value)} onClick={e => e.stopPropagation()} />;
}

function TreeRow({ entry, depth, openPath, expanded, toggle, actions, renaming, setRenaming }: { entry: Entry; depth: number; openPath: string | null; expanded: Set<string>; toggle: (path: string) => void; actions: TreeActions; renaming: string | null; setRenaming: (path: string | null) => void }) {
  const isFolder = entry.kind === 'folder';
  const isOpen = expanded.has(entry.path);
  const selected = entry.path === openPath;
  const label = isFolder ? entry.name : entry.kind === 'note' ? noteName(entry.path) : entry.name;
  const commit = (value: string) => {
    setRenaming(null);
    const name = value.trim();
    if (name && name !== label) actions.rename(entry.path, name);
  };
  const items = isFolder ? <>
    <ContextItem onSelect={() => actions.createNote(entry.path)}>New note</ContextItem>
    <ContextItem onSelect={() => actions.createFolder(entry.path)}>New folder</ContextItem>
    <ContextSeparator />
    <ContextItem onSelect={() => setRenaming(entry.path)}>Rename</ContextItem>
    <ContextItem onSelect={() => actions.reveal(entry.path)}>Show in file manager</ContextItem>
    <ContextSeparator />
    <ContextItem danger onSelect={() => actions.trash(entry.path)}>Delete</ContextItem>
  </> : <>
    {entry.kind === 'note' && <ContextItem onSelect={() => actions.open(entry.path)}>Open</ContextItem>}
    <ContextItem onSelect={() => setRenaming(entry.path)}>Rename</ContextItem>
    <ContextItem onSelect={() => actions.reveal(entry.path)}>Show in file manager</ContextItem>
    <ContextSeparator />
    <ContextItem danger onSelect={() => actions.trash(entry.path)}>Delete</ContextItem>
  </>;
  return <>
    <ContextMenu items={items}>
      <div role="treeitem" aria-expanded={isFolder ? isOpen : undefined} aria-selected={selected} tabIndex={-1}
        className={`tree-row ${isFolder ? 'is-folder' : 'is-file'} ${selected ? 'is-selected' : ''} ${entry.kind === 'file' ? 'is-attachment' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => { if (isFolder) toggle(entry.path); else if (entry.kind === 'note') actions.open(entry.path); }}
        onKeyDown={e => { if (e.key === 'Enter') { if (isFolder) toggle(entry.path); else if (entry.kind === 'note') actions.open(entry.path); } if (e.key === 'F2') setRenaming(entry.path); }}>
        {isFolder ? <span className="tree-chevron">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span> : <span className="tree-chevron" />}
        {renaming === entry.path ? <RenameInput initial={label} onCommit={commit} onCancel={() => setRenaming(null)} /> : <span className="tree-label" title={entry.path}>{label}</span>}
      </div>
    </ContextMenu>
    {isFolder && isOpen && entry.children?.map(child => <TreeRow key={child.path} entry={child} depth={depth + 1} openPath={openPath} expanded={expanded} toggle={toggle} actions={actions} renaming={renaming} setRenaming={setRenaming} />)}
  </>;
}

export function FileTree({ vaultName, tree, openPath, expanded, toggle, collapseAll, actions, renaming, setRenaming }: { vaultName: string; tree: Entry[]; openPath: string | null; expanded: Set<string>; toggle: (path: string) => void; collapseAll: () => void; actions: TreeActions; renaming: string | null; setRenaming: (path: string | null) => void }) {
  const rootItems = <>
    <ContextItem onSelect={() => actions.createNote('')}>New note</ContextItem>
    <ContextItem onSelect={() => actions.createFolder('')}>New folder</ContextItem>
    <ContextSeparator />
    <ContextItem onSelect={() => actions.reveal('')}>Show in file manager</ContextItem>
  </>;
  return <div className="pane">
    <div className="pane-header">
      <span className="pane-title" title={vaultName}>{vaultName}</span>
      <div className="pane-actions">
        <IconButton label="New note" onClick={() => actions.createNote('')}><FilePlus size={16} /></IconButton>
        <IconButton label="New folder" onClick={() => actions.createFolder('')}><FolderPlus size={16} /></IconButton>
        <IconButton label="Collapse all" onClick={collapseAll}><ChevronsDownUp size={16} /></IconButton>
      </div>
    </div>
    <ContextMenu items={rootItems}>
      <div className="tree" role="tree" aria-label="Files">
        {tree.map(entry => <TreeRow key={entry.path} entry={entry} depth={0} openPath={openPath} expanded={expanded} toggle={toggle} actions={actions} renaming={renaming} setRenaming={setRenaming} />)}
        {tree.length === 0 && <p className="pane-empty">No notes yet. Press <kbd>{window.vault.platform === 'darwin' ? '⌘' : 'Ctrl'} N</kbd> to make one.</p>}
      </div>
    </ContextMenu>
  </div>;
}

function Highlighted({ text, from, length }: { text: string; from: number; length: number }) {
  const start = Math.max(0, from - 40);
  const before = (start > 0 ? '…' : '') + text.slice(start, from);
  return <>{before}<mark>{text.slice(from, from + length)}</mark>{text.slice(from + length, from + length + 120)}</>;
}

export function SearchPane({ query, setQuery, hits, onOpen, inputRef }: { query: string; setQuery: (value: string) => void; hits: SearchHit[]; onOpen: (path: string, line?: number, from?: number, length?: number) => void; inputRef: RefObject<HTMLInputElement | null> }) {
  const total = hits.reduce((sum, hit) => sum + hit.total, 0);
  return <div className="pane">
    <div className="pane-header"><span className="pane-title">Search</span></div>
    <label className="search-box"><SearchIcon size={15} /><input ref={inputRef} aria-label="Search all notes" placeholder="Search all notes" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} />{query && <button type="button" className="icon-button small" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}><X size={14} /></button>}</label>
    {query.trim() && <div className="search-summary">{hits.length ? `${total} ${total === 1 ? 'match' : 'matches'} in ${hits.length} ${hits.length === 1 ? 'note' : 'notes'}` : 'No matches'}</div>}
    <div className="search-results">
      {hits.map(hit => <div key={hit.path} className="search-hit">
        <button type="button" className="search-hit-title" onClick={() => onOpen(hit.path)} title={hit.path}>{noteName(hit.path)}<span className="search-count">{hit.total}</span></button>
        {hit.matches.map(match => <button type="button" key={`${hit.path}:${match.line}`} className="search-match" onClick={() => onOpen(hit.path, match.line, match.from, match.length)}><Highlighted text={match.text} from={match.from} length={match.length} /></button>)}
      </div>)}
    </div>
  </div>;
}
