import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, BookOpen, ChevronRight, Code, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, ListTodo, MoreHorizontal, PenLine, Quote, SlidersHorizontal, Strikethrough, Underline } from 'lucide-react';
import type { EditorView } from '@codemirror/view';
import { commands, createEditor, type EditorHost, type NoteEditor } from './editor';
import { fontFamily, type DocumentFormat } from './frontmatter';
import { folderOf, noteName, renderMarkdown, type Resolver } from './markdown';
import type { Mode } from './types';
import { IconButton, Menu, MenuCheck, MenuItem, MenuSeparator, keys } from './ui';

type Props = {
  path: string; text: string; mode: Mode; resolve: Resolver; format: DocumentFormat; toolbar: boolean;
  host: () => EditorHost;
  editorRef: MutableRefObject<NoteEditor | null>;
  articleRef: MutableRefObject<HTMLElement | null>;
  focusTitle: number;
  justRenamed: boolean;
  onRename: (name: string) => Promise<void>;
  onToggleReading: () => void;
  onToggleSource: () => void;
  onToggleToolbar: () => void;
  onOpenFormat: () => void;
  onInsertImage: () => void;
  onExport: () => void;
  onExportDocx: () => void;
  onReveal: () => void;
  onTrash: () => void;
  onOpenLink: (target: string, heading?: string) => void;
  onOpenTag: (tag: string) => void;
  onOpenExternal: (url: string) => void;
};

export function NoteView(props: Props) {
  const { path, text, mode, resolve, format, toolbar, host, editorRef, articleRef, focusTitle, justRenamed } = props;
  const container = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const handledFocus = useRef(0);
  const pendingRename = useRef<string | null>(null);
  const [title, setTitle] = useState(noteName(path));
  const editMode = mode === 'reading' ? 'live' : mode;
  const focusTitleInput = () => { titleRef.current?.focus(); titleRef.current?.select(); };

  useLayoutEffect(() => {
    if (!container.current) return;
    const editor = createEditor(container.current, host, editMode);
    editorRef.current = editor;
    return () => { editor.destroy(); editorRef.current = null; };
    // The editor is created once. Mode and content changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A rename keeps the editor state and the focus. Any other path change opens the note.
  useLayoutEffect(() => {
    setTitle(noteName(path)); pendingRename.current = null;
    if (justRenamed) return;
    editorRef.current?.open(path, text);
    if (focusTitle !== handledFocus.current) { handledFocus.current = focusTitle; focusTitleInput(); }
    else if (mode !== 'reading') editorRef.current?.view.focus();
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { editorRef.current?.replaceText(text); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { editorRef.current?.setMode(editMode); }, [editMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusTitle !== handledFocus.current) { handledFocus.current = focusTitle; focusTitleInput(); } }, [focusTitle]);

  const html = useMemo(() => mode === 'reading' ? renderMarkdown(text, path, resolve) : '', [mode, text, path, resolve]);
  useEffect(() => {
    if (mode !== 'reading' || !articleRef.current) return;
    articleRef.current.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((input, index) => { input.disabled = false; input.dataset.task = String(index); });
  }, [html, mode, articleRef]);

  const commitTitle = () => {
    const name = title.trim();
    if (!name) { setTitle(noteName(path)); return; }
    if (name === noteName(path) || pendingRename.current === name) return;
    pendingRename.current = name;
    void props.onRename(name).finally(() => { if (pendingRename.current === name) pendingRename.current = null; });
  };
  const run = (command: (view: EditorView) => boolean) => () => { const view = editorRef.current?.view; if (!view) return; command(view); view.focus(); };
  const onArticleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const link = target.closest('a');
    if (link) {
      event.preventDefault();
      if (link.classList.contains('internal-link')) props.onOpenLink(link.dataset.href || '', link.dataset.heading);
      else if (link.classList.contains('tag')) props.onOpenTag(link.dataset.tag || '');
      else if (link.classList.contains('external-link') && link.getAttribute('href')) props.onOpenExternal(link.getAttribute('href') as string);
      return;
    }
    const checkbox = target.closest<HTMLInputElement>('input[type=checkbox]');
    if (checkbox && editorRef.current) {
      event.preventDefault();
      const index = Number(checkbox.dataset.task);
      const view = editorRef.current.view;
      let seen = 0;
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n);
        const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/.exec(line.text);
        if (!match) continue;
        if (seen++ === index) { const from = line.from + match[1].length; view.dispatch({ changes: { from, to: from + 1, insert: match[2] === ' ' ? 'x' : ' ' } }); break; }
      }
    }
  };
  const crumbs = folderOf(path) ? folderOf(path).split('/') : [];
  const bodyStyle = { '--doc-font': fontFamily(format.font) || undefined, '--doc-size': `${format.size}pt`, '--doc-line': format.lineHeight, '--doc-align': format.align } as CSSProperties;
  const aligns: [DocumentFormat['align'], typeof AlignLeft, string, string][] = [['left', AlignLeft, 'Align left', 'Mod+Alt+L'], ['center', AlignCenter, 'Align center', 'Mod+Alt+E'], ['right', AlignRight, 'Align right', 'Mod+Alt+R'], ['justify', AlignJustify, 'Justify', 'Mod+Alt+J']];
  return <div className="note-view">
    <header className="view-header">
      <nav className="breadcrumbs" aria-label="Note location">{crumbs.map((crumb, index) => <span key={index} className="crumb">{crumb}<ChevronRight size={13} /></span>)}<span className="crumb is-current">{noteName(path)}</span></nav>
      <div className="view-actions">
        <IconButton label="Document format" onClick={props.onOpenFormat}><SlidersHorizontal size={16} /></IconButton>
        <IconButton label={mode === 'reading' ? `Edit (${keys('Mod+E')})` : `Reading view (${keys('Mod+E')})`} onClick={props.onToggleReading} testId="mode-toggle">{mode === 'reading' ? <PenLine size={17} /> : <BookOpen size={17} />}</IconButton>
        <Menu trigger={<button type="button" className="icon-button" aria-label="More options"><MoreHorizontal size={17} /></button>}>
          <MenuCheck checked={toolbar} onSelect={props.onToggleToolbar}>Formatting toolbar</MenuCheck>
          <MenuCheck checked={mode === 'source'} onSelect={props.onToggleSource}>Source mode</MenuCheck>
          <MenuSeparator />
          <MenuItem onSelect={props.onOpenFormat}>Document format…</MenuItem>
          <MenuItem onSelect={props.onExport} hint={keys('Mod+Shift+E')}>Export to PDF…</MenuItem>
          <MenuItem onSelect={props.onExportDocx}>Export to Word…</MenuItem>
          <MenuItem onSelect={props.onReveal}>Show in file manager</MenuItem>
          <MenuItem onSelect={() => { titleRef.current?.focus(); titleRef.current?.select(); }}>Rename</MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={props.onTrash}>Delete note</MenuItem>
        </Menu>
      </div>
    </header>
    {toolbar && mode !== 'reading' && <div className="format-toolbar" role="toolbar" aria-label="Formatting">
      <select className="style-select" aria-label="Paragraph style" value="" onChange={e => { run(commands.heading(Number(e.target.value)))(); }}>
        <option value="" disabled>Style</option><option value="0">Normal text</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
      </select>
      <IconButton label={`Bold (${keys('Mod+B')})`} onClick={run(commands.bold)}><Bold size={15} /></IconButton>
      <IconButton label={`Italic (${keys('Mod+I')})`} onClick={run(commands.italic)}><Italic size={15} /></IconButton>
      <IconButton label={`Underline (${keys('Mod+U')})`} onClick={run(commands.underline)}><Underline size={15} /></IconButton>
      <IconButton label={`Strikethrough (${keys('Mod+Shift+X')})`} onClick={run(commands.strike)}><Strikethrough size={15} /></IconButton>
      <IconButton label={`Highlight (${keys('Mod+Shift+H')})`} onClick={run(commands.highlight)}><Highlighter size={15} /></IconButton>
      <IconButton label={`Link (${keys('Mod+K')})`} onClick={run(commands.link)}><Link2 size={15} /></IconButton>
      <span className="toolbar-gap" />
      <IconButton label="Bullet list" onClick={run(commands.bullet)}><List size={16} /></IconButton>
      <IconButton label="Numbered list" onClick={run(commands.number)}><ListOrdered size={16} /></IconButton>
      <IconButton label={`Task list (${keys('Mod+L')})`} onClick={run(commands.task)}><ListTodo size={16} /></IconButton>
      <IconButton label="Quote" onClick={run(commands.quote)}><Quote size={15} /></IconButton>
      <IconButton label="Inline code" onClick={run(commands.code)}><Code size={15} /></IconButton>
      <span className="toolbar-gap" />
      {aligns.map(([value, Icon, label, shortcut]) => <IconButton key={value} label={`${label} (${keys(shortcut)})`} onClick={run(commands.align(value))}><Icon size={15} /></IconButton>)}
      <span className="toolbar-gap" />
      <IconButton label="Insert image" onClick={props.onInsertImage}><ImagePlus size={15} /></IconButton>
    </div>}
    <div className="view-scroll">
      <div className={`note-body ${format.indent ? 'has-indent' : ''}`} style={bodyStyle}>
        <input ref={titleRef} className="inline-title" aria-label="Note title" value={title} maxLength={200} spellCheck={false} onChange={e => setTitle(e.target.value)} onBlur={commitTitle}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitTitle(); if (mode !== 'reading') editorRef.current?.view.focus(); }
            if (e.key === 'Escape') { setTitle(noteName(path)); (e.target as HTMLInputElement).blur(); }
          }} />
        <div ref={container} className="editor-container" hidden={mode === 'reading'} />
        {mode === 'reading' && <article ref={articleRef} className="reading-view markdown" aria-label="Note preview" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </div>
  </div>;
}
