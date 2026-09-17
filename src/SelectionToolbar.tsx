import type { EditorView } from '@codemirror/view';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, ListTodo, Quote, Strikethrough, Underline } from 'lucide-react';
import { commands } from './editor';
import { keys } from './ui';

type Tool = { label: string; icon: typeof Bold; run: (view: EditorView) => boolean };
const GROUPS: Tool[][] = [
  [
    { label: `Bold (${keys('Mod+B')})`, icon: Bold, run: commands.bold },
    { label: `Italic (${keys('Mod+I')})`, icon: Italic, run: commands.italic },
    { label: `Underline (${keys('Mod+U')})`, icon: Underline, run: commands.underline },
    { label: `Strikethrough (${keys('Mod+Shift+X')})`, icon: Strikethrough, run: commands.strike },
    { label: `Highlight (${keys('Mod+Shift+H')})`, icon: Highlighter, run: commands.highlight },
    { label: `Inline code (${keys('Mod+`')})`, icon: Code, run: commands.code },
    { label: `Link (${keys('Mod+K')})`, icon: Link2, run: commands.link },
  ],
  [
    { label: 'Bullet list', icon: List, run: commands.bullet },
    { label: 'Numbered list', icon: ListOrdered, run: commands.number },
    { label: `Task list (${keys('Mod+L')})`, icon: ListTodo, run: commands.task },
    { label: 'Quote', icon: Quote, run: commands.quote },
  ],
  [
    { label: `Align left (${keys('Mod+Alt+L')})`, icon: AlignLeft, run: commands.align('left') },
    { label: `Align center (${keys('Mod+Alt+E')})`, icon: AlignCenter, run: commands.align('center') },
    { label: `Align right (${keys('Mod+Alt+R')})`, icon: AlignRight, run: commands.align('right') },
    { label: `Justify (${keys('Mod+Alt+J')})`, icon: AlignJustify, run: commands.align('justify') },
  ],
];

// The toolbar that floats above selected text. It is mounted inside a CodeMirror tooltip.
export function SelectionToolbar({ view, onInsertImage }: { view: EditorView; onInsertImage: () => void }) {
  const run = (command: (view: EditorView) => boolean) => () => { command(view); view.focus(); };
  const currentHeading = () => { const line = view.state.doc.lineAt(view.state.selection.main.from); const match = /^(#{1,6})\s/.exec(line.text); return match ? String(match[1].length) : '0'; };
  return <div className="selection-toolbar" role="toolbar" aria-label="Selection formatting">
    <select className="style-select" aria-label="Paragraph style" title="Paragraph style" value={currentHeading()} onChange={e => { commands.heading(Number(e.target.value))(view); view.focus(); }}>
      <option value="0">Text</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option><option value="4">Heading 4</option>
    </select>
    {GROUPS.map((group, index) => <div className="toolbar-group" key={index}>{group.map(tool => <button type="button" key={tool.label} className="icon-button" aria-label={tool.label} title={tool.label} onClick={run(tool.run)}><tool.icon size={15} /></button>)}</div>)}
    <div className="toolbar-group"><button type="button" className="icon-button" aria-label="Insert image" title="Insert image" onClick={onInsertImage}><ImagePlus size={15} /></button></div>
  </div>;
}
