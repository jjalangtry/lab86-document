import { type ReactNode } from 'react';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as ContextPrimitive from '@radix-ui/react-context-menu';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

export const isMac = window.vault?.platform === 'darwin';
export const mod = isMac ? '⌘' : 'Ctrl';
export const keys = (combo: string) => combo.replace('Mod', mod).replace('Shift', isMac ? '⇧' : 'Shift').replace('Alt', isMac ? '⌥' : 'Alt').split('+').join(isMac ? '' : '+');

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ label, children, side = 'bottom' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return <TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="tooltip" side={side} sideOffset={6}>{label}</TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root>;
}

export function IconButton({ label, active, className = '', children, onClick, side, disabled, testId }: { label: string; active?: boolean; className?: string; children: ReactNode; onClick?: () => void; side?: 'top' | 'bottom' | 'left' | 'right'; disabled?: boolean; testId?: string }) {
  return <Tooltip label={label} side={side}><button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} data-testid={testId}>{children}</button></Tooltip>;
}

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center' }) {
  return <DropdownPrimitive.Root><DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger><DropdownPrimitive.Portal><DropdownPrimitive.Content className="menu" align={align} sideOffset={6} collisionPadding={8}>{children}</DropdownPrimitive.Content></DropdownPrimitive.Portal></DropdownPrimitive.Root>;
}
export function MenuItem({ children, disabled, onSelect, danger, hint }: { children: ReactNode; disabled?: boolean; onSelect: () => void; danger?: boolean; hint?: string }) {
  return <DropdownPrimitive.Item className={`menu-item ${danger ? 'is-danger' : ''}`} disabled={disabled} onSelect={onSelect}>{children}{hint && <span className="menu-hint">{hint}</span>}</DropdownPrimitive.Item>;
}
export function MenuCheck({ children, checked, onSelect }: { children: ReactNode; checked: boolean; onSelect: () => void }) {
  return <DropdownPrimitive.CheckboxItem className="menu-item" checked={checked} onSelect={onSelect}>{children}<span className="menu-hint">{checked ? '✓' : ''}</span></DropdownPrimitive.CheckboxItem>;
}
export const MenuSeparator = () => <DropdownPrimitive.Separator className="menu-separator" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <DropdownPrimitive.Label className="menu-label">{children}</DropdownPrimitive.Label>;

export function ContextMenu({ children, items }: { children: ReactNode; items: ReactNode }) {
  return <ContextPrimitive.Root><ContextPrimitive.Trigger asChild>{children}</ContextPrimitive.Trigger><ContextPrimitive.Portal><ContextPrimitive.Content className="menu" collisionPadding={8}>{items}</ContextPrimitive.Content></ContextPrimitive.Portal></ContextPrimitive.Root>;
}
export function ContextItem({ children, onSelect, danger }: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return <ContextPrimitive.Item className={`menu-item ${danger ? 'is-danger' : ''}`} onSelect={onSelect}>{children}</ContextPrimitive.Item>;
}
export const ContextSeparator = () => <ContextPrimitive.Separator className="menu-separator" />;

export function Dialog({ open, onOpenChange, title, description, children, className = '' }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; className?: string }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="modal-backdrop" /><DialogPrimitive.Content className={`modal ${className}`}><DialogPrimitive.Title className="modal-title">{title}</DialogPrimitive.Title>{description ? <DialogPrimitive.Description className="modal-description">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="visually-hidden">{title}</DialogPrimitive.Description>}{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
