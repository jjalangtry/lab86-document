// The JSON Canvas format that Obsidian uses for .canvas files.
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type CanvasNode = { id: string; type: 'text' | 'file'; text?: string; file?: string; x: number; y: number; width: number; height: number; color?: string };
export type CanvasEdge = { id: string; fromNode: string; toNode: string; fromSide?: Side; toSide?: Side; label?: string };
// `tldraw` holds a drawing layer. Obsidian ignores the extra key.
export type CanvasData = { nodes: CanvasNode[]; edges: CanvasEdge[]; tldraw?: unknown };

export function parseCanvas(text: string): CanvasData {
  try {
    const data = JSON.parse(text || '{}') as Partial<CanvasData>;
    const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter(n => n && typeof n.id === 'string' && (n.type === 'text' || n.type === 'file') && Number.isFinite(n.x) && Number.isFinite(n.y)).map(n => ({ ...n, width: Number.isFinite(n.width) ? n.width : 250, height: Number.isFinite(n.height) ? n.height : 120 }));
    const ids = new Set(nodes.map(n => n.id));
    const edges = (Array.isArray(data.edges) ? data.edges : []).filter(e => e && typeof e.id === 'string' && ids.has(e.fromNode) && ids.has(e.toNode));
    return data.tldraw && typeof data.tldraw === 'object' ? { nodes, edges, tldraw: data.tldraw } : { nodes, edges };
  } catch { return { nodes: [], edges: [] }; }
}
export const serializeCanvas = (data: CanvasData) => JSON.stringify(data, null, '\t');
