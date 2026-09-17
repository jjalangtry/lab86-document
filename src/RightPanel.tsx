import { useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react';
import { DEFAULT_FORMAT, FONTS, FONT_SIZES, LINE_HEIGHTS, MARGINS, PAPERS, type Align, type DocumentFormat, type Paper } from './frontmatter';
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


export function FormatPane({ format, onChange, onReset }: { format: DocumentFormat; onChange: (patch: Partial<DocumentFormat>) => void; onReset: () => void }) {
  const custom = format.font !== '' && !FONTS.includes(format.font);
  const [customMode, setCustomMode] = useState(custom);
  const isDefault = (Object.keys(DEFAULT_FORMAT) as (keyof DocumentFormat)[]).every(key => format[key] === DEFAULT_FORMAT[key]);
  const aligns: [Align, typeof AlignLeft, string][] = [['left', AlignLeft, 'Align left'], ['center', AlignCenter, 'Align center'], ['right', AlignRight, 'Align right'], ['justify', AlignJustify, 'Justify']];
  return <div className="pane format-pane">
    <div className="pane-header"><span className="pane-title">Format</span></div>
    <div className="pane-scroll">
      <h3>Text</h3>
      <label>Font
        <select aria-label="Font" value={customMode || custom ? 'custom' : format.font} onChange={e => { if (e.target.value === 'custom') { setCustomMode(true); return; } setCustomMode(false); onChange({ font: e.target.value }); }}>
          <option value="">Default (Inter)</option>
          {FONTS.map(font => <option key={font} value={font}>{font}</option>)}
          <option value="custom">Other font…</option>
        </select>
        {(customMode || custom) && <input type="text" aria-label="Font name" placeholder="Font name as installed" defaultValue={custom ? format.font : ''} onBlur={e => onChange({ font: e.target.value.trim() })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onChange({ font: (e.target as HTMLInputElement).value.trim() }); } }} />}
      </label>
      <div className="field-row">
        <label>Size<select aria-label="Font size" value={format.size} onChange={e => onChange({ size: Number(e.target.value) })}>{[...new Set([...FONT_SIZES, format.size])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size} pt</option>)}</select></label>
        <label>Line spacing<select aria-label="Line spacing" value={format.lineHeight} onChange={e => onChange({ lineHeight: Number(e.target.value) })}>{(LINE_HEIGHTS.some(([v]) => v === format.lineHeight) ? LINE_HEIGHTS : [...LINE_HEIGHTS, [format.lineHeight, String(format.lineHeight)] as [number, string]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <label>Alignment
        <div className="segmented" role="group" aria-label="Alignment">{aligns.map(([value, Icon, label]) => <button type="button" key={value} className={format.align === value ? 'is-active' : ''} aria-label={label} aria-pressed={format.align === value} title={label} onClick={() => onChange({ align: value })}><Icon size={16} /></button>)}</div>
      </label>
      <label className="check"><input type="checkbox" checked={format.indent} onChange={e => onChange({ indent: e.target.checked })} />Indent the first line of paragraphs</label>
      <h3>Page</h3>
      <div className="field-row">
        <label>Paper<select aria-label="Paper size" value={format.paper} onChange={e => onChange({ paper: e.target.value as Paper })}>{PAPERS.map(paper => <option key={paper} value={paper}>{paper}</option>)}</select></label>
        <label>Margins<select aria-label="Margins" value={format.margin} onChange={e => onChange({ margin: Number(e.target.value) })}>{[...new Set([...MARGINS, format.margin])].sort((a, b) => a - b).map(margin => <option key={margin} value={margin}>{margin} in</option>)}</select></label>
      </div>
      <label className="check"><input type="checkbox" checked={format.pageNumbers} onChange={e => onChange({ pageNumbers: e.target.checked })} />Page numbers in the PDF</label>
      <p className="pane-empty">The settings are stored at the top of the note. The PDF export uses them.</p>
      {!isDefault && <button type="button" className="reset" onClick={onReset}>Reset to defaults</button>}
    </div>
  </div>;
}
