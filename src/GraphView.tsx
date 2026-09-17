import { useEffect, useMemo, useRef, useState } from 'react';
import { noteName, parseWiki, WIKI_PATTERN, type Resolver } from './markdown';
import { stripFrontmatter } from './frontmatter';
import type { Note } from './types';

type GraphNode = { id: string; label: string; x: number; y: number; vx: number; vy: number; degree: number };
type GraphEdge = { a: number; b: number };
type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; index: Map<string, number> };

const MAX_NODES = 1500;

// Builds the note graph. Unresolved links become nodes too, drawn hollow like Obsidian.
function buildGraph(notes: Note[], resolve: Resolver, focus: string | null, local: boolean): Graph {
  const index = new Map<string, number>();
  const nodes: GraphNode[] = [];
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];
  const node = (id: string, label: string) => {
    let at = index.get(id);
    if (at === undefined) { at = nodes.length; index.set(id, at); nodes.push({ id, label, x: (Math.random() - 0.5) * 600, y: (Math.random() - 0.5) * 600, vx: 0, vy: 0, degree: 0 }); }
    return at;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key); edges.push({ a, b }); nodes[a].degree++; nodes[b].degree++;
  };
  const list = notes.slice(0, MAX_NODES);
  for (const note of list) node(note.path, noteName(note.path));
  for (const note of list) {
    const from = index.get(note.path) as number;
    for (const match of stripFrontmatter(note.text).matchAll(WIKI_PATTERN)) {
      const target = parseWiki(match).target;
      if (!target) continue;
      const resolved = resolve(target, note.path);
      if (resolved) { if (resolved.endsWith('.md')) link(from, node(resolved, noteName(resolved))); }
      else link(from, node(`unresolved:${target.toLowerCase()}`, target));
    }
  }
  if (local && focus && index.has(focus)) {
    const center = index.get(focus) as number;
    const keep = new Set<number>([center]);
    for (const edge of edges) { if (edge.a === center) keep.add(edge.b); if (edge.b === center) keep.add(edge.a); }
    const remap = new Map<number, number>();
    const localNodes = nodes.filter((_, i) => keep.has(i));
    localNodes.forEach((n, i) => remap.set(index.get(n.id) as number, i));
    const localEdges = edges.filter(e => keep.has(e.a) && keep.has(e.b)).map(e => ({ a: remap.get(e.a) as number, b: remap.get(e.b) as number }));
    const localIndex = new Map(localNodes.map((n, i) => [n.id, i]));
    return { nodes: localNodes, edges: localEdges, index: localIndex };
  }
  return { nodes, edges, index };
}

export function GraphView({ notes, resolve, focus, onOpen }: { notes: Note[]; resolve: Resolver; focus: string | null; onOpen: (path: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [local, setLocal] = useState(false);
  const [filter, setFilter] = useState('');
  const graph = useMemo(() => buildGraph(notes, resolve, focus, local), [notes, resolve, focus, local]);
  const state = useRef({ graph, scale: 1, panX: 0, panY: 0, hover: -1, drag: -1, panning: false, lastX: 0, lastY: 0, moved: false, alpha: 1, frame: 0 });
  const filterRef = useRef(filter); filterRef.current = filter;
  const focusRef = useRef(focus); focusRef.current = focus;

  useEffect(() => {
    const previous = state.current.graph;
    // Keep positions of nodes that already exist so the layout does not jump.
    for (const node of graph.nodes) { const old = previous.nodes[previous.index.get(node.id) ?? -1]; if (old) { node.x = old.x; node.y = old.y; } }
    state.current.graph = graph; state.current.alpha = 1;
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const s = state.current;
    let running = true;
    const colors = () => {
      const style = getComputedStyle(canvas);
      return { text: style.getPropertyValue('--text-normal').trim() || '#ddd', muted: style.getPropertyValue('--text-faint').trim() || '#666', accent: style.getPropertyValue('--text-accent').trim() || '#8a6cef', line: style.getPropertyValue('--border-strong').trim() || '#444', bg: style.getPropertyValue('--bg-primary').trim() || '#1e1e1e' };
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas); resize();
    const tick = () => {
      const { nodes, edges } = s.graph;
      if (s.alpha > 0.005 && nodes.length) {
        const repulsion = 1600, spring = 0.02, gravity = 0.01, damping = 0.85, cell = 500;
        // Repulsion only acts within 500 px, so nodes are bucketed into a grid and only
        // neighboring cells are compared. This keeps large graphs near linear per frame.
        const buckets = new Map<string, number[]>();
        for (let i = 0; i < nodes.length; i++) {
          const key = `${Math.floor(nodes[i].x / cell)},${Math.floor(nodes[i].y / cell)}`;
          const list = buckets.get(key); if (list) list.push(i); else buckets.set(key, [i]);
        }
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
          for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
            const list = buckets.get(`${cx + ox},${cy + oy}`);
            if (!list) continue;
            for (const j of list) {
              if (j <= i) continue;
              const b = nodes[j];
              let dx = a.x - b.x, dy = a.y - b.y;
              let d2 = dx * dx + dy * dy;
              if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
              if (d2 > 250000) continue;
              const force = repulsion / d2 * s.alpha;
              const d = Math.sqrt(d2);
              const fx = dx / d * force, fy = dy / d * force;
              a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
            }
          }
        }
        for (const edge of edges) {
          const a = nodes[edge.a], b = nodes[edge.b];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (d - 90) * spring * s.alpha;
          const fx = dx / d * force, fy = dy / d * force;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (i === s.drag) { n.vx = 0; n.vy = 0; continue; }
          n.vx = (n.vx - n.x * gravity * s.alpha) * damping; n.vy = (n.vy - n.y * gravity * s.alpha) * damping;
          n.x += n.vx; n.y += n.vy;
        }
        s.alpha *= 0.985;
      }
      draw();
      if (running) s.frame = requestAnimationFrame(tick);
    };
    const draw = () => {
      const { nodes, edges } = s.graph;
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.width / ratio, height = canvas.height / ratio;
      const c = colors();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.translate(width / 2 + s.panX, height / 2 + s.panY);
      context.scale(s.scale, s.scale);
      const query = filterRef.current.trim().toLowerCase();
      const neighbors = new Set<number>();
      if (s.hover >= 0) for (const edge of edges) { if (edge.a === s.hover) neighbors.add(edge.b); if (edge.b === s.hover) neighbors.add(edge.a); }
      const dim = (i: number) => (s.hover >= 0 && i !== s.hover && !neighbors.has(i)) || (query && !nodes[i].label.toLowerCase().includes(query));
      context.lineWidth = 1 / s.scale;
      for (const edge of edges) {
        const a = nodes[edge.a], b = nodes[edge.b];
        const active = s.hover >= 0 && (edge.a === s.hover || edge.b === s.hover);
        context.strokeStyle = active ? c.accent : c.line;
        context.globalAlpha = active ? 0.9 : (s.hover >= 0 || query) ? 0.15 : 0.5;
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
      }
      context.globalAlpha = 1;
      const focusIndex = focusRef.current ? s.graph.index.get(focusRef.current) ?? -1 : -1;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const radius = 3 + Math.min(9, Math.sqrt(n.degree) * 1.6);
        const unresolved = n.id.startsWith('unresolved:');
        context.globalAlpha = dim(i) ? 0.2 : 1;
        context.beginPath(); context.arc(n.x, n.y, radius, 0, Math.PI * 2);
        if (unresolved) { context.strokeStyle = c.muted; context.lineWidth = 1.5 / s.scale; context.stroke(); }
        else { context.fillStyle = i === focusIndex || i === s.hover ? c.accent : c.muted; context.fill(); }
        if (s.scale > 0.7 || i === s.hover || neighbors.has(i) || i === focusIndex || nodes.length < 40) {
          context.fillStyle = c.text;
          context.font = `${Math.max(9, 11 / s.scale)}px Inter, sans-serif`;
          context.textAlign = 'center';
          context.fillText(n.label, n.x, n.y + radius + 12 / s.scale);
        }
      }
      context.globalAlpha = 1;
    };
    const toGraph = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (clientX - rect.left - rect.width / 2 - s.panX) / s.scale, y: (clientY - rect.top - rect.height / 2 - s.panY) / s.scale };
    };
    const nodeAt = (clientX: number, clientY: number) => {
      const p = toGraph(clientX, clientY);
      let best = -1, bestDistance = Infinity;
      s.graph.nodes.forEach((n, i) => { const d = Math.hypot(n.x - p.x, n.y - p.y); const radius = (3 + Math.min(9, Math.sqrt(n.degree) * 1.6)) + 6 / s.scale; if (d < radius && d < bestDistance) { best = i; bestDistance = d; } });
      return best;
    };
    const onMove = (event: MouseEvent) => {
      if (s.drag >= 0) { const p = toGraph(event.clientX, event.clientY); const n = s.graph.nodes[s.drag]; n.x = p.x; n.y = p.y; s.moved = true; s.alpha = Math.max(s.alpha, 0.3); return; }
      if (s.panning) { s.panX += event.clientX - s.lastX; s.panY += event.clientY - s.lastY; s.lastX = event.clientX; s.lastY = event.clientY; s.moved = true; return; }
      const hover = nodeAt(event.clientX, event.clientY);
      if (hover !== s.hover) { s.hover = hover; canvas.style.cursor = hover >= 0 ? 'pointer' : 'grab'; }
    };
    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      s.moved = false; s.lastX = event.clientX; s.lastY = event.clientY;
      const hit = nodeAt(event.clientX, event.clientY);
      if (hit >= 0) s.drag = hit; else s.panning = true;
    };
    const onUp = (event: MouseEvent) => {
      if (s.drag >= 0 && !s.moved) { const id = s.graph.nodes[s.drag].id; if (!id.startsWith('unresolved:')) onOpen(id); }
      s.drag = -1; s.panning = false;
      if (event.type === 'mouseleave') s.hover = -1;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left - rect.width / 2, my = event.clientY - rect.top - rect.height / 2;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = Math.min(4, Math.max(0.15, s.scale * factor));
      const ratio = next / s.scale;
      s.panX = mx - (mx - s.panX) * ratio; s.panY = my - (my - s.panY) * ratio; s.scale = next;
    };
    canvas.addEventListener('mousemove', onMove); canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp); canvas.addEventListener('mouseleave', onUp); canvas.addEventListener('wheel', onWheel, { passive: false });
    s.frame = requestAnimationFrame(tick);
    return () => {
      running = false; cancelAnimationFrame(s.frame); observer.disconnect();
      canvas.removeEventListener('mousemove', onMove); canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp); canvas.removeEventListener('mouseleave', onUp); canvas.removeEventListener('wheel', onWheel);
    };
  }, [onOpen]);

  return <div className="graph-view" data-testid="graph-view">
    <div className="graph-controls">
      <input aria-label="Filter graph" placeholder="Filter notes" value={filter} onChange={e => setFilter(e.target.value)} />
      <label className="check"><input type="checkbox" checked={local} onChange={e => setLocal(e.target.checked)} />Local graph</label>
      <span className="graph-count">{graph.nodes.length} {graph.nodes.length === 1 ? 'note' : 'notes'} · {graph.edges.length} {graph.edges.length === 1 ? 'link' : 'links'}</span>
    </div>
    <canvas ref={canvasRef} className="graph-canvas" aria-label="Graph of notes" role="img" />
  </div>;
}
