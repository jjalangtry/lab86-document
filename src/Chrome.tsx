import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, CalendarDays, CircleHelp, Command, FilePlus, Files, FolderOpen, Hash, LayoutDashboard, Link2, ListTree, PanelLeft, PanelRight, Plus, Search as SearchIcon, Settings, SlidersHorizontal, Waypoints, X } from 'lucide-react';
import { tabTitle, type Tab } from './store/tabs';
import type { Workspace } from './store/workspace';
import type { VaultInfo } from './types';
import { IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, keys } from './ui';

// The icon strip on the left edge, like Obsidian's ribbon.
export function Ribbon({ info, graphOpen, editing, run, onOpenVault, onCreateVault, onSwitchVault, onRevealVault, onCloseVault }: { info: VaultInfo; graphOpen: boolean; editing: boolean; run: (id: string) => void; onOpenVault: () => void; onCreateVault: () => void; onSwitchVault: (path: string) => void; onRevealVault: () => void; onCloseVault: () => void }) {
  const others = info.recent.filter(p => p !== info.vault?.path);
  return <nav className="ribbon" aria-label="Ribbon">
    <IconButton label={`Quick switcher (${keys('Mod+O')})`} side="right" onClick={() => run('quick-switcher')}><SearchIcon size={18} /></IconButton>
    <IconButton label={`Graph view (${keys('Mod+G')})`} side="right" active={graphOpen} onClick={() => run('graph')}><Waypoints size={18} /></IconButton>
    <IconButton label="Create new canvas" side="right" onClick={() => run('new-canvas')}><LayoutDashboard size={18} /></IconButton>
    <IconButton label={`Today's daily note (${keys('Mod+D')})`} side="right" onClick={() => run('daily-note')}><CalendarDays size={18} /></IconButton>
    <IconButton label="Insert template" side="right" disabled={!editing} onClick={() => run('insert-template')}><FilePlus size={18} /></IconButton>
    <IconButton label={`Command palette (${keys('Mod+P')})`} side="right" onClick={() => run('command-palette')}><Command size={18} /></IconButton>
    <span className="ribbon-space" />
    <Menu align="start" trigger={<button type="button" className="icon-button" aria-label="Vault options" title={info.vault?.name}><FolderOpen size={18} /></button>}>
      <MenuLabel>{info.vault?.path}</MenuLabel>
      <MenuItem onSelect={onOpenVault}>Open another vault…</MenuItem>
      <MenuItem onSelect={onCreateVault}>Create new vault…</MenuItem>
      {others.length > 0 && <MenuSeparator />}
      {others.map(p => <MenuItem key={p} onSelect={() => onSwitchVault(p)}>{p.split(/[\\/]/).pop()}</MenuItem>)}
      <MenuSeparator />
      <MenuItem onSelect={onRevealVault}>Show vault in file manager</MenuItem>
      <MenuItem onSelect={onCloseVault}>Close vault</MenuItem>
    </Menu>
    <IconButton label="Help" side="right" onClick={() => run('help')}><CircleHelp size={18} /></IconButton>
    <IconButton label={`Settings (${keys('Mod+,')})`} side="right" onClick={() => run('settings')}><Settings size={18} /></IconButton>
  </nav>;
}

export function LeftTitleBar({ tab, onTab, onHide }: { tab: Workspace['leftTab']; onTab: (tab: Workspace['leftTab']) => void; onHide: () => void }) {
  return <div className="titlebar-left">
    <IconButton label="Files" active={tab === 'files'} onClick={() => onTab('files')}><Files size={17} /></IconButton>
    <IconButton label={`Search (${keys('Mod+Shift+F')})`} active={tab === 'search'} onClick={() => onTab('search')}><SearchIcon size={17} /></IconButton>
    <IconButton label="Bookmarks" active={tab === 'bookmarks'} onClick={() => onTab('bookmarks')}><Bookmark size={17} /></IconButton>
    <span className="titlebar-space" />
    <IconButton label={`Hide sidebar (${keys('Mod+Shift+L')})`} onClick={onHide}><PanelLeft size={17} /></IconButton>
  </div>;
}

export function RightTitleBar({ tab, onTab, onHide }: { tab: Workspace['rightTab']; onTab: (tab: Workspace['rightTab']) => void; onHide: () => void }) {
  return <div className="titlebar-right">
    <IconButton label="Backlinks" active={tab === 'backlinks'} onClick={() => onTab('backlinks')}><Link2 size={17} /></IconButton>
    <IconButton label="Outgoing links" active={tab === 'outgoing'} onClick={() => onTab('outgoing')}><ArrowUpRight size={17} /></IconButton>
    <IconButton label="Tags" active={tab === 'tags'} onClick={() => onTab('tags')}><Hash size={17} /></IconButton>
    <IconButton label="Outline" active={tab === 'outline'} onClick={() => onTab('outline')}><ListTree size={17} /></IconButton>
    <IconButton label="Format" active={tab === 'format'} onClick={() => onTab('format')}><SlidersHorizontal size={17} /></IconButton>
    <span className="titlebar-space" />
    <IconButton label={`Hide right sidebar (${keys('Mod+Shift+R')})`} onClick={onHide}><PanelRight size={17} /></IconButton>
  </div>;
}

type TabStripProps = { tabs: Tab[]; activeTab: number; left: boolean; right: boolean; canGoBack: boolean; canGoForward: boolean; onSelect: (id: number) => void; onClose: (id: number) => void; onNew: () => void; onBack: () => void; onForward: () => void; onShowLeft: () => void; onShowRight: () => void };
export function TabStrip({ tabs, activeTab, left, right, canGoBack, canGoForward, onSelect, onClose, onNew, onBack, onForward, onShowLeft, onShowRight }: TabStripProps) {
  return <div className="tab-strip" role="tablist" aria-label="Open notes">
    {!left && <IconButton label={`Show sidebar (${keys('Mod+Shift+L')})`} onClick={onShowLeft}><PanelLeft size={17} /></IconButton>}
    <IconButton label="Back" disabled={!canGoBack} onClick={onBack}><ArrowLeft size={16} /></IconButton>
    <IconButton label="Forward" disabled={!canGoForward} onClick={onForward}><ArrowRight size={16} /></IconButton>
    <div className="tabs">
      {tabs.map(tab => { const title = tabTitle(tab.path); return <div key={tab.id} role="tab" aria-selected={tab.id === activeTab} tabIndex={-1} className={`tab ${tab.id === activeTab ? 'is-active' : ''}`} title={tab.path || undefined}
        onClick={() => onSelect(tab.id)} onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}>
        <span className="tab-title">{title}</span>
        <button type="button" className="tab-close" aria-label={`Close ${title}`} onClick={e => { e.stopPropagation(); onClose(tab.id); }}><X size={13} /></button>
      </div>; })}
      <IconButton label={`New tab (${keys('Mod+T')})`} onClick={onNew}><Plus size={16} /></IconButton>
    </div>
    {!right && <IconButton label={`Show right sidebar (${keys('Mod+Shift+R')})`} onClick={onShowRight}><PanelRight size={17} /></IconButton>}
  </div>;
}
