import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export type PaletteItem = { id: string; label: ReactNode; detail?: string; hint?: string; run: () => void };

export function Palette({ open, title, placeholder, items, query, onQuery, onClose, empty }: { open: boolean; title: string; placeholder: string; items: PaletteItem[]; query: string; onQuery: (value: string) => void; onClose: () => void; empty: string }) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const run = (item: PaletteItem | undefined) => { if (!item) return; onClose(); item.run(); };
  return <DialogPrimitive.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="modal-backdrop is-light" />
      <DialogPrimitive.Content className="palette" aria-label={title}>
        <DialogPrimitive.Title className="visually-hidden">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="visually-hidden">{placeholder}</DialogPrimitive.Description>
        <input className="palette-input" autoFocus aria-label={placeholder} placeholder={placeholder} value={query} onChange={e => onQuery(e.target.value)} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `palette-${active}` : undefined}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(v => Math.min(items.length - 1, v + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(v => Math.max(0, v - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
          }} />
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {items.map((item, index) => <div key={item.id} id={`palette-${index}`} data-index={index} role="option" aria-selected={index === active} className={`palette-item ${index === active ? 'is-active' : ''}`} onMouseMove={() => setActive(index)} onClick={() => run(item)}>
            <span className="palette-label">{item.label}{item.detail && <small>{item.detail}</small>}</span>
            {item.hint && <kbd className="palette-hint">{item.hint}</kbd>}
          </div>)}
          {items.length === 0 && <div className="palette-empty">{empty}</div>}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
