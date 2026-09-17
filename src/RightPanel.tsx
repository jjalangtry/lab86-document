import { noteName, type Backlink, type Heading } from './markdown';

export function OutlinePane({ headings, onSelect }: { headings: Heading[]; onSelect: (index: number, line: number) => void }) {
  const minimum = headings.reduce((min, h) => Math.min(min, h.level), 6);
  return <div className="pane">
    <div className="pane-header"><span className="pane-title">Outline</span></div>
    <div className="pane-scroll">
      {headings.length === 0 && <p className="pane-empty">No headings in this note.</p>}
      {headings.map((heading, index) => <button type="button" key={`${heading.line}:${heading.text}`} className="outline-item" style={{ paddingLeft: 12 + (heading.level - minimum) * 14 }} onClick={() => onSelect(index, heading.line)}>{heading.text}</button>)}
    </div>
  </div>;
}

export function BacklinksPane({ links, onOpen }: { links: Backlink[]; onOpen: (path: string, line?: number) => void }) {
  const count = links.reduce((sum, link) => sum + link.lines.length, 0);
  return <div className="pane">
    <div className="pane-header"><span className="pane-title">Backlinks</span><span className="pane-count">{count}</span></div>
    <div className="pane-scroll">
      {links.length === 0 && <p className="pane-empty">No other note links here.</p>}
      {links.map(link => <div key={link.path} className="search-hit">
        <button type="button" className="search-hit-title" onClick={() => onOpen(link.path)} title={link.path}>{noteName(link.path)}<span className="search-count">{link.lines.length}</span></button>
        {link.lines.slice(0, 5).map(line => <button type="button" key={line.line} className="search-match" onClick={() => onOpen(link.path, line.line)}>{line.text.slice(0, 160)}</button>)}
      </div>)}
    </div>
  </div>;
}
