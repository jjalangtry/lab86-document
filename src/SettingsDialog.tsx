import { Moon, Monitor, Sun } from 'lucide-react';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import type { Mode, Theme } from './types';
import { Dialog } from './ui';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; settings: Settings; onChange: (patch: Partial<Settings>) => void; theme: Theme; onTheme: (theme: Theme) => void; mode: Mode; onMode: (mode: Mode) => void; version: string; onShowLogs: () => void };

export function SettingsDialog({ open, onOpenChange, settings, onChange, theme, onTheme, mode, onMode, version, onShowLogs }: Props) {
  const folder = (key: 'dailyFolder' | 'templatesFolder' | 'attachmentsFolder', label: string, hint: string) => <label className="settings-row"><span><strong>{label}</strong><small>{hint}</small></span><input type="text" aria-label={label} defaultValue={settings[key]} onBlur={e => onChange({ [key]: e.target.value.trim() || DEFAULT_SETTINGS[key] })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} /></label>;
  return <Dialog open={open} onOpenChange={onOpenChange} title="Settings" className="settings-dialog">
    <div className="settings-body">
      <h3>Appearance</h3>
      <div className="settings-row"><span><strong>Theme</strong><small>Follow the system or choose one.</small></span>
        <div className="segmented" role="group" aria-label="Theme">
          {([['system', Monitor, 'System'], ['light', Sun, 'Light'], ['dark', Moon, 'Dark']] as const).map(([value, Icon, label]) => <button type="button" key={value} className={theme === value ? 'is-active' : ''} aria-pressed={theme === value} aria-label={`${label} theme`} onClick={() => onTheme(value)}><Icon size={14} />{label}</button>)}
        </div>
      </div>
      <label className="settings-row"><span><strong>Text size</strong><small>The base size of note text.</small></span><select aria-label="Text size" value={settings.textSize} onChange={e => onChange({ textSize: Number(e.target.value) })}>{[14, 15, 16, 17, 18, 20].map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
      <label className="settings-row check"><span><strong>Readable line length</strong><small>Limit the width of the note text.</small></span><input type="checkbox" checked={settings.readableWidth} onChange={e => onChange({ readableWidth: e.target.checked })} /></label>
      <h3>Editor</h3>
      <label className="settings-row"><span><strong>Default view</strong><small>The view for a note when it opens.</small></span><select aria-label="Default view" value={mode} onChange={e => onMode(e.target.value as Mode)}><option value="live">Live preview</option><option value="source">Source mode</option><option value="reading">Reading view</option></select></label>
      <label className="settings-row check"><span><strong>Spellcheck</strong><small>Mark misspelled words in the editor.</small></span><input type="checkbox" checked={settings.spellcheck} onChange={e => onChange({ spellcheck: e.target.checked })} /></label>
      <label className="settings-row check"><span><strong>Line numbers</strong><small>Show line numbers in source mode.</small></span><input type="checkbox" checked={settings.showLineNumbers} onChange={e => onChange({ showLineNumbers: e.target.checked })} /></label>
      <h3>Files and links</h3>
      <label className="settings-row"><span><strong>New note location</strong><small>Where a new note goes.</small></span><select aria-label="New note location" value={settings.newNoteLocation} onChange={e => onChange({ newNoteLocation: e.target.value as Settings['newNoteLocation'] })}><option value="root">Vault folder</option><option value="current">Same folder as the current note</option></select></label>
      {folder('attachmentsFolder', 'Attachments folder', 'Pasted and inserted images go here.')}
      {folder('dailyFolder', 'Daily notes folder', 'Daily notes are named by date.')}
      {folder('templatesFolder', 'Templates folder', 'Notes in this folder are templates.')}
      <h3>About</h3>
      <div className="settings-row"><span><strong>Document {version}</strong><small>Errors and freezes are written to a log file.</small></span><button type="button" className="settings-button" onClick={onShowLogs}>Show logs folder</button></div>
    </div>
  </Dialog>;
}
