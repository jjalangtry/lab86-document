import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Maximize, Plus, Trash2 } from 'lucide-react';
import { noteName, renderMarkdown, type Resolver } from './markdown';
import { stripFrontmatter } from './frontmatter';
import type { Note } from './types';
import { IconButton, Tooltip } from './ui';

import { parseCanvas, serializeCanvas, type CanvasData, type CanvasNode, type Side } from './canvas';
const COLORS: [string, string][] = [['', 'None'], ['1', 'Red'], ['2', 'Orange'], ['3', 'Yellow'], ['4', 'Green'], ['5', 'Cyan'], ['6', 'Purple']];
const GRID = 10;
const uid = () => Math.random().toString(16).slice(2, 18);

function anchor(node: CanvasNode, side: Side) {
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
  return side === 'top' ? { x: cx, y: node.y } : side === 'bottom' ? { x: cx, y: node.y + node.height } : side === 'left' ? { x: node.x, y: cy } : { x: node.x + node.width, y: cy };
}
function nearestSides(a: CanvasNode, b: CanvasNode): [Side, Side] {
  const dx = (b.x + b.width / 2) - (a.x + a.width / 2), dy = (b.y + b.height / 2) - (a.y + a.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ['right', 'left'] : ['left', 'right'];
  return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}
function edgePath(from: { x: number; y: number }, fromSide: Side, to: { x: number; y: number }, toSide: Side) {
  const bend = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) / 3);
  const out = (side: Side) => side === 'top' ? [0, -bend] : side === 'bottom' ? [0, bend] : side === 'left' ? [-bend, 0] : [bend, 0];
  const [ax, ay] = out(fromSide), [bx, by] = out(toSide);
  return `M ${from.x} ${from.y} C ${from.x + ax} ${from.y + ay}, ${to.x + bx} ${to.y + by}, ${to.x} ${to.y}`;
}

type Props = { path: string; text: string; onChange: (text: string) => void; resolve: Resolver; notes: Note[]; onOpenNote: (path: string) => void; pickNote: () => Promise<string | null> };

export function CanvasView({ path, text, onChange, resolve, notes, onOpenNote, pickNote }: Props) {
  const data = useMemo(() => parseCanvas(text), [text]);
  const [view, setView] = useState(() => { try { return JSON.parse(localStorage.getItem(`document.canvas:${path}`) || '') as { x: number; y: number; zoom: number }; } catch { return { x: 80, y: 60, zoom: 1 }; } });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ from: string; side: Side; x: number; y: number } | null>(null);
  const [labelEdit, setLabelEdit] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'pan' | 'move' | 'resize'; id?: string; startX: number; startY: number; origin: { x: number; y: number; width?: number; height?: number }; moved: boolean } | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const dataRef = useRef(data); dataRef.current = data;
  useEffect(() => { localStorage.setItem(`document.canvas:${path}`, JSON.stringify(view)); }, [view, path]);

  const commit = useCallback((next: CanvasData) => onChange(serializeCanvas(next)), [onChange]);
  const updateNode = useCallback((id: string, patch: Partial<CanvasNode>) => commit({ ...dataRef.current, nodes: dataRef.current.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }), [commit]);
  const toBoard = (clientX: number, clientY: number) => {
    const rect = board.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (rect?.left ?? 0) - v.x) / v.zoom, y: (clientY - (rect?.top ?? 0) - v.y) / v.zoom };
  };
  const snap = (value: number) => Math.round(value / GRID) * GRID;
  const addText = (x: number, y: number) => {
    const node: CanvasNode = { id: uid(), type: 'text', text: '', x: snap(x), y: snap(y), width: 260, height: 120 };
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
    setSelected(node.id); setEditing(node.id);
  };
  const addNote = async () => {
    const file = await pickNote();
    if (!file) return;
    const rect = board.current?.getBoundingClientRect();
    const center = toBoard((rect?.left ?? 0) + (rect?.width ?? 600) / 2, (rect?.top ?? 0) + (rect?.height ?? 400) / 2);
    const node: CanvasNode = { id: uid(), type: 'file', file, x: snap(center.x - 150), y: snap(center.y - 100), width: 300, height: 200 };
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
    setSelected(node.id);
  };
  const remove = useCallback(() => {
    if (!selected) return;
    const current = dataRef.current;
    if (current.nodes.some(n => n.id === selected)) commit({ nodes: current.nodes.filter(n => n.id !== selected), edges: current.edges.filter(e => e.fromNode !== selected && e.toNode !== selected) });
    else commit({ ...current, edges: current.edges.filter(e => e.id !== selected) });
    setSelected(null);
  }, [commit, selected]);
  const fit = () => {
    const rect = board.current?.getBoundingClientRect();
    if (!rect || !data.nodes.length) { setView({ x: 80, y: 60, zoom: 1 }); return; }
    const minX = Math.min(...data.nodes.map(n => n.x)), minY = Math.min(...data.nodes.map(n => n.y));
    const maxX = Math.max(...data.nodes.map(n => n.x + n.width)), maxY = Math.max(...data.nodes.map(n => n.y + n.height));
    const zoom = Math.min(2, Math.max(0.1, Math.min((rect.width - 80) / (maxX - minX), (rect.height - 80) / (maxY - minY))));
    setView({ zoom, x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom });
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const d = drag.current;
      if (d) {
        const v = viewRef.current;
        const dx = (event.clientX - d.startX), dy = (event.clientY - d.startY);
        if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
        if (d.kind === 'pan') setView({ ...v, x: d.origin.x + dx, y: d.origin.y + dy });
        else if (d.kind === 'move' && d.id) updateNode(d.id, { x: snap(d.origin.x + dx / v.zoom), y: snap(d.origin.y + dy / v.zoom) });
        else if (d.kind === 'resize' && d.id) updateNode(d.id, { width: Math.max(120, snap((d.origin.width || 0) + dx / v.zoom)), height: Math.max(60, snap((d.origin.height || 0) + dy / v.zoom)) });
      }
      if (connecting) { const p = toBoard(event.clientX, event.clientY); setConnecting({ ...connecting, x: p.x, y: p.y }); }
    };
    const onUp = (event: MouseEvent) => {
      if (connecting) {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
        const toId = target?.dataset.nodeId;
        const current = dataRef.current;
        const from = current.nodes.find(n => n.id === connecting.from), to = toId ? current.nodes.find(n => n.id === toId) : undefined;
        if (from && to && from.id !== to.id && !current.edges.some(e => e.fromNode === from.id && e.toNode === to.id)) {
          const [, toSide] = nearestSides(from, to);
          commit({ ...current, edges: [...current.edges, { id: uid(), fromNode: from.id, toNode: to.id, fromSide: connecting.side, toSide }] });
        }
        setConnecting(null);
      }
      drag.current = null;
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [commit, connecting, updateNode]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing || labelEdit) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); remove(); }
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, labelEdit, remove, selected]);

  const onWheel = (event: React.WheelEvent) => {
    const v = viewRef.current;
    if (event.ctrlKey || event.metaKey) {
      const rect = board.current?.getBoundingClientRect();
      const mx = event.clientX - (rect?.left ?? 0), my = event.clientY - (rect?.top ?? 0);
      const zoom = Math.min(3, Math.max(0.1, v.zoom * Math.exp(-event.deltaY * 0.0015)));
      const ratio = zoom / v.zoom;
      setView({ zoom, x: mx - (mx - v.x) * ratio, y: my - (my - v.y) * ratio });
    } else setView({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY });
  };
  const selectedNode = data.nodes.find(n => n.id === selected);
  const nodeById = new Map(data.nodes.map(n => [n.id, n]));
  const notePreview = (file: string) => {
    const resolved = resolve(file, path);
    const note = resolved ? notes.find(n => n.path === resolved) : null;
    return { resolved, html: note ? renderMarkdown(stripFrontmatter(note.text).slice(0, 1500), note.path, resolve) : '<p class="pane-empty">Note not found</p>' };
  };
  return <div className="canvas-view" data-testid="canvas-view">
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
      <IconButton label="Add card" onClick={() => { const rect = board.current?.getBoundingClientRect(); const c = toBoard((rect?.left ?? 0) + (rect?.width ?? 600) / 2, (rect?.top ?? 0) + (rect?.height ?? 400) / 2); addText(c.x - 130, c.y - 60); }}><Plus size={16} /></IconButton>
      <IconButton label="Add note from vault" onClick={() => void addNote()}><FileText size={16} /></IconButton>
      <IconButton label="Zoom to fit" onClick={fit}><Maximize size={16} /></IconButton>
      {selectedNode && <div className="canvas-colors" role="group" aria-label="Card color">{COLORS.map(([value, label]) => <Tooltip key={value || 'none'} label={label}><button type="button" className={`canvas-swatch color-${value || 'none'} ${(selectedNode.color || '') === value ? 'is-active' : ''}`} aria-label={`${label} color`} onClick={() => updateNode(selectedNode.id, { color: value || undefined })} /></Tooltip>)}</div>}
      {selected && <IconButton label="Delete selection" onClick={remove}><Trash2 size={16} /></IconButton>}
      <span className="canvas-hint">Double-click the board to add a card. Drag a side handle to connect cards. Ctrl+wheel zooms.</span>
    </div>
    <div ref={board} className="canvas-board" onWheel={onWheel}
      onMouseDown={e => { if (e.button !== 0 || e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('canvas-layer')) return; setSelected(null); setEditing(null); drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origin: { x: view.x, y: view.y }, moved: false }; }}
      onDoubleClick={e => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-layer')) { const p = toBoard(e.clientX, e.clientY); addText(p.x - 130, p.y - 60); } }}>
      <div className="canvas-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="canvas-edges" aria-hidden="true">
          <defs><marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          {data.edges.map(edge => {
            const from = nodeById.get(edge.fromNode), to = nodeById.get(edge.toNode);
            if (!from || !to) return null;
            const [autoFrom, autoTo] = nearestSides(from, to);
            const fromSide = edge.fromSide || autoFrom, toSide = edge.toSide || autoTo;
            const a = anchor(from, fromSide), b = anchor(to, toSide);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            return <g key={edge.id} className={`canvas-edge ${selected === edge.id ? 'is-selected' : ''}`} onMouseDown={e => { e.stopPropagation(); setSelected(edge.id); }} onDoubleClick={e => { e.stopPropagation(); setLabelEdit(edge.id); }}>
              <path d={edgePath(a, fromSide, b, toSide)} className="canvas-edge-hit" />
              <path d={edgePath(a, fromSide, b, toSide)} className="canvas-edge-line" markerEnd="url(#canvas-arrow)" />
              {labelEdit === edge.id ? <foreignObject x={mid.x - 80} y={mid.y - 14} width={160} height={28}><input autoFocus aria-label="Connection label" className="canvas-edge-input" defaultValue={edge.label || ''} onBlur={e => { commit({ ...dataRef.current, edges: dataRef.current.edges.map(x => x.id === edge.id ? { ...x, label: e.target.value.trim() || undefined } : x) }); setLabelEdit(null); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} /></foreignObject>
                : edge.label && <text x={mid.x} y={mid.y} className="canvas-edge-label" textAnchor="middle" dominantBaseline="middle">{edge.label}</text>}
            </g>;
          })}
          {connecting && (() => { const from = nodeById.get(connecting.from); if (!from) return null; const a = anchor(from, connecting.side); return <path d={edgePath(a, connecting.side, { x: connecting.x, y: connecting.y }, 'left')} className="canvas-edge-line is-drawing" />; })()}
        </svg>
        {data.nodes.map(node => {
          const active = selected === node.id;
          const preview = node.type === 'file' && node.file ? notePreview(node.file) : null;
          return <div key={node.id} data-node-id={node.id} className={`canvas-node type-${node.type} color-${node.color || 'none'} ${active ? 'is-selected' : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
            onMouseDown={e => { if (e.button !== 0 || editing === node.id) return; e.stopPropagation(); setSelected(node.id); drag.current = { kind: 'move', id: node.id, startX: e.clientX, startY: e.clientY, origin: { x: node.x, y: node.y }, moved: false }; }}
            onDoubleClick={e => { e.stopPropagation(); if (node.type === 'text') setEditing(node.id); else if (preview?.resolved) onOpenNote(preview.resolved); }}>
            {node.type === 'file' ? <>
              <div className="canvas-node-title" onMouseDown={e => e.stopPropagation()} onClick={() => preview?.resolved && onOpenNote(preview.resolved)}>{noteName(node.file || '')}</div>
              <div className="canvas-node-body markdown" dangerouslySetInnerHTML={{ __html: preview?.html || '' }} />
            </> : editing === node.id
              ? <textarea autoFocus className="canvas-node-edit" aria-label="Card text" defaultValue={node.text || ''} onMouseDown={e => e.stopPropagation()} onBlur={e => { updateNode(node.id, { text: e.target.value }); setEditing(null); }} onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }} />
              : <div className="canvas-node-body markdown" dangerouslySetInnerHTML={{ __html: node.text?.trim() ? renderMarkdown(node.text, path, resolve) : '<p class="canvas-placeholder">Double-click to write</p>' }} />}
            {active && <>
              {(['top', 'right', 'bottom', 'left'] as Side[]).map(side => <button type="button" key={side} className={`canvas-handle side-${side}`} aria-label={`Connect from ${side}`} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); const p = anchor(node, side); setConnecting({ from: node.id, side, x: p.x, y: p.y }); }} />)}
              <div className="canvas-resize" aria-hidden="true" onMouseDown={e => { e.stopPropagation(); drag.current = { kind: 'resize', id: node.id, startX: e.clientX, startY: e.clientY, origin: { x: node.x, y: node.y, width: node.width, height: node.height }, moved: false }; }} />
            </>}
          </div>;
        })}
      </div>
      {data.nodes.length === 0 && <p className="canvas-empty">Double-click anywhere to add a card.</p>}
    </div>
  </div>;
}
