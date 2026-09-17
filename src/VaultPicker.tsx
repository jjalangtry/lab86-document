import { FolderOpen, FolderPlus, X } from 'lucide-react';
import { Tooltip } from './ui';

export function VaultPicker({ recent, onChoose, onOpen, onForget, error }: { recent: string[]; onChoose: (create: boolean) => void; onOpen: (path: string) => void; onForget: (path: string) => void; error: string }) {
  return <div className="vault-picker">
    <div className="vault-card">
      <h1 className="vault-brand">Document</h1>
      <p className="vault-lead">A vault is a folder of Markdown notes on this computer.</p>
      <div className="vault-actions">
        <button type="button" className="vault-action" onClick={() => onChoose(true)}><FolderPlus size={18} /><span><strong>Create new vault</strong><small>Make an empty folder for new notes.</small></span></button>
        <button type="button" className="vault-action" onClick={() => onChoose(false)}><FolderOpen size={18} /><span><strong>Open folder as vault</strong><small>Use a folder that already has Markdown files.</small></span></button>
      </div>
      {recent.length > 0 && <div className="vault-recent">
        <h2>Recent vaults</h2>
        <ul>{recent.map(path => <li key={path}><button type="button" onClick={() => onOpen(path)}><strong>{path.split(/[\\/]/).pop()}</strong><small>{path}</small></button><Tooltip label="Remove from list"><button type="button" className="icon-button" aria-label="Remove from list" onClick={() => onForget(path)}><X size={14} /></button></Tooltip></li>)}</ul>
      </div>}
      {error && <p className="vault-error" role="alert">{error}</p>}
    </div>
  </div>;
}
