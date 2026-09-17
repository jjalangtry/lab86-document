import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, drawSelection, dropCursor, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import type { InlineContext, MarkdownConfig } from '@lezer/markdown';
import { tags as t } from '@lezer/highlight';
import { isImagePath, vaultUrl } from './markdown';
import type { Mode } from './types';
import { tabIndentation } from './tab-indentation';

export type EditorHost = {
  resolve: (target: string) => string | null;
  noteNames: () => string[];
  openLink: (target: string) => void;
  openExternal: (url: string) => void;
  openTag: (tag: string) => void;
  saveImage: (file: File) => Promise<string | null>;
  onChange: (text: string) => void;
};

// Lezer extension for [[wikilinks]], ![[embeds]] and #tags.
const LBRACKET = 91, RBRACKET = 93, BANG = 33, HASH = 35, NEWLINE = 10;
const wikiConfig: MarkdownConfig = {
  defineNodes: [{ name: 'WikiLink', style: t.link }, { name: 'WikiEmbed', style: t.link }, { name: 'WikiLinkMark', style: t.processingInstruction }, { name: 'Tag', style: t.labelName }],
  parseInline: [{
    name: 'WikiLink', before: 'Link',
    parse(cx: InlineContext, next: number, pos: number) {
      const embed = next === BANG;
      const open = embed ? pos + 1 : pos;
      if ((embed && (cx.char(open) !== LBRACKET || cx.char(open + 1) !== LBRACKET)) || (!embed && (next !== LBRACKET || cx.char(pos + 1) !== LBRACKET))) return -1;
      let end = open + 2;
      while (end < cx.end && !(cx.char(end) === RBRACKET && cx.char(end + 1) === RBRACKET)) {
        const char = cx.char(end);
        if (char === NEWLINE || char === LBRACKET) return -1;
        end++;
      }
      if (end >= cx.end || end === open + 2) return -1;
      return cx.addElement(cx.elt(embed ? 'WikiEmbed' : 'WikiLink', pos, end + 2, [cx.elt('WikiLinkMark', open, open + 2), cx.elt('WikiLinkMark', end, end + 2)]));
    },
  }, {
    name: 'Tag', before: 'Link',
    parse(cx: InlineContext, next: number, pos: number) {
      if (next !== HASH) return -1;
      const previous = pos > cx.offset ? String.fromCharCode(cx.char(pos - 1)) : ' ';
      if (!/\s/.test(previous)) return -1;
      let end = pos + 1;
      while (end < cx.end && /[\p{L}\p{N}_/-]/u.test(String.fromCharCode(cx.char(end)))) end++;
      const body = cx.slice(pos + 1, end);
      if (!body || !/[\p{L}_]/u.test(body)) return -1;
      return cx.addElement(cx.elt('Tag', pos, end));
    },
  }],
};

const highlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: t.processingInstruction, color: 'var(--text-faint)', fontWeight: '400', fontStyle: 'normal' },
  { tag: t.url, color: 'var(--text-faint)', textDecoration: 'none' },
  { tag: t.link, color: 'var(--text-accent)' },
  { tag: t.labelName, color: 'var(--text-accent)' },
  { tag: t.quote, color: 'var(--text-muted)' },
  { tag: t.contentSeparator, color: 'var(--text-faint)' },
  { tag: t.escape, color: 'var(--text-faint)' },
  { tag: t.atom, color: 'var(--text-faint)' },
]);

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const span = document.createElement('span'); span.className = 'cm-bullet'; span.textContent = '•'; return span; }
}
class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const hr = document.createElement('hr'); hr.className = 'cm-hr'; return hr; }
}
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(other: CheckboxWidget) { return other.checked === this.checked; }
  ignoreEvent() { return false; }
  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.className = 'cm-task'; input.checked = this.checked; input.setAttribute('aria-label', 'Task');
    input.addEventListener('mousedown', event => event.preventDefault());
    input.addEventListener('click', event => {
      event.preventDefault();
      const pos = view.posAtDOM(input);
      const line = view.state.doc.lineAt(pos);
      const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/.exec(line.text);
      if (!match) return;
      const from = line.from + match[1].length;
      view.dispatch({ changes: { from, to: from + 1, insert: match[2] === ' ' ? 'x' : ' ' } });
    });
    return input;
  }
}
class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) { super(); }
  eq(other: ImageWidget) { return other.src === this.src && other.alt === this.alt; }
  toDOM() {
    const wrap = document.createElement('span'); wrap.className = 'cm-image';
    const img = document.createElement('img'); img.src = this.src; img.alt = this.alt; img.draggable = false;
    wrap.append(img);
    return wrap;
  }
}

function livePreview(host: () => EditorHost) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      const { state } = view, doc = state.doc, ranges = state.selection.ranges;
      const marks: { from: number; to: number; deco: Decoration }[] = [];
      const touches = (from: number, to: number) => ranges.some(r => r.from <= to && r.to >= from);
      const touchesLines = (from: number, to: number) => touches(doc.lineAt(from).from, doc.lineAt(to).to);
      const add = (from: number, to: number, deco: Decoration) => { if (to >= from) marks.push({ from, to, deco }); };
      const hide = (from: number, to: number) => { if (to > from) add(from, to, Decoration.replace({})); };
      const lineClass = (from: number, to: number, cls: string) => {
        for (let line = doc.lineAt(from); ; line = doc.line(line.number + 1)) {
          add(line.from, line.from, Decoration.line({ class: cls }));
          if (line.to >= to || line.number >= doc.lines) break;
        }
      };
      const spaceAfter = (pos: number) => (state.sliceDoc(pos, pos + 1) === ' ' ? 1 : 0);
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({ from, to, enter: node => {
          const name = node.name;
          if (/^ATXHeading[1-6]$/.test(name)) {
            add(doc.lineAt(node.from).from, doc.lineAt(node.from).from, Decoration.line({ class: `cm-heading cm-h${name.slice(-1)}` }));
            const mark = node.node.getChild('HeaderMark');
            if (mark && !touchesLines(node.from, node.to)) hide(mark.from, mark.to + spaceAfter(mark.to));
            return;
          }
          if (/^SetextHeading[12]$/.test(name)) { add(doc.lineAt(node.from).from, doc.lineAt(node.from).from, Decoration.line({ class: `cm-heading cm-h${name.slice(-1)}` })); return; }
          if (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'Strikethrough' || name === 'InlineCode') {
            if (name === 'InlineCode') add(node.from, node.to, Decoration.mark({ class: 'cm-inline-code' }));
            if (!touches(node.from, node.to)) for (const child of node.node.getChildren(name === 'InlineCode' ? 'CodeMark' : name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark')) hide(child.from, child.to);
            return;
          }
          if (name === 'Link') {
            const linkMarks = node.node.getChildren('LinkMark'), url = node.node.getChild('URL');
            const href = url ? state.sliceDoc(url.from, url.to) : '';
            if (linkMarks.length >= 2 && !touches(node.from, node.to)) {
              hide(linkMarks[0].from, linkMarks[0].to);
              hide(linkMarks[1].from, node.to);
              add(linkMarks[0].to, linkMarks[1].from, Decoration.mark({ class: 'cm-mdlink', attributes: { 'data-href': href } }));
            }
            return;
          }
          if (name === 'Image') {
            const url = node.node.getChild('URL');
            const href = url ? state.sliceDoc(url.from, url.to) : '';
            let decoded = href; try { decoded = decodeURIComponent(href); } catch { /* keep as typed */ }
            const resolved = href && !/^https?:/i.test(href) ? host().resolve(decoded) : null;
            if (resolved && isImagePath(resolved) && !touches(node.from, node.to)) { add(node.from, node.to, Decoration.replace({ widget: new ImageWidget(vaultUrl(resolved), decoded) })); return false; }
            return;
          }
          if (name === 'WikiLink' || name === 'WikiEmbed') {
            const wikiMarks = node.node.getChildren('WikiLinkMark');
            if (wikiMarks.length < 2) return;
            const innerFrom = wikiMarks[0].to, innerTo = wikiMarks[1].from;
            const inner = state.sliceDoc(innerFrom, innerTo);
            const pipe = inner.indexOf('|'), hash = inner.indexOf('#');
            const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).replace(/#.*$/, '').trim();
            const resolved = target ? host().resolve(target) : null;
            const revealed = touches(node.from, node.to);
            if (name === 'WikiEmbed' && resolved && isImagePath(resolved)) {
              if (!revealed) { add(node.from, node.to, Decoration.replace({ widget: new ImageWidget(vaultUrl(resolved), target) })); return false; }
              return;
            }
            if (!revealed) {
              hide(node.from, innerFrom);
              if (pipe >= 0) hide(innerFrom, innerFrom + pipe + 1);
              else if (hash >= 0 && target) add(innerFrom + hash, innerTo, Decoration.mark({ class: 'cm-wikilink-heading' }));
              hide(innerTo, node.to);
            }
            add(innerFrom, innerTo, Decoration.mark({ class: `cm-wikilink${resolved ? '' : ' is-unresolved'}`, attributes: { 'data-target': target || '' } }));
            return false;
          }
          if (name === 'Tag') { add(node.from, node.to, Decoration.mark({ class: 'cm-tag', attributes: { 'data-tag': state.sliceDoc(node.from + 1, node.to) } })); return; }
          if (name === 'ListItem') {
            const mark = node.node.getChild('ListMark');
            if (!mark) return;
            const line = doc.lineAt(mark.from);
            const task = node.node.getChild('Task')?.getChild('TaskMarker');
            if (task && task.from > mark.to) add(line.from, line.from, Decoration.line({ class: `cm-task-line${/x/i.test(state.sliceDoc(task.from, task.to)) ? ' is-checked' : ''}` }));
            if (touches(line.from, line.to)) return;
            if (task && task.from > mark.to) add(mark.from, task.to, Decoration.replace({ widget: new CheckboxWidget(/x/i.test(state.sliceDoc(task.from, task.to))) }));
            else if (/^[-*+]$/.test(state.sliceDoc(mark.from, mark.to))) add(mark.from, mark.to, Decoration.replace({ widget: new BulletWidget() }));
            return;
          }
          if (name === 'Blockquote') {
            lineClass(node.from, node.to, 'cm-quote');
            if (!touchesLines(node.from, node.to)) for (const mark of node.node.getChildren('QuoteMark')) hide(mark.from, mark.to + spaceAfter(mark.to));
            return;
          }
          if (name === 'FencedCode') {
            lineClass(node.from, node.to, 'cm-codeblock');
            add(doc.lineAt(node.from).from, doc.lineAt(node.from).from, Decoration.line({ class: 'cm-codeblock-start' }));
            add(doc.lineAt(node.to).from, doc.lineAt(node.to).from, Decoration.line({ class: 'cm-codeblock-end' }));
            const fences = node.node.getChildren('CodeMark');
            // Line breaks cannot be replaced from a view plugin, so the fence lines stay as empty lines.
            if (fences.length === 2 && !touches(node.from, node.to)) {
              const first = doc.lineAt(fences[0].from), last = doc.lineAt(fences[1].from);
              if (last.number > first.number + 1) {
                hide(first.from, first.to); hide(last.from, last.to);
                add(first.from, first.from, Decoration.line({ class: 'cm-fence-hidden' }));
                add(last.from, last.from, Decoration.line({ class: 'cm-fence-hidden' }));
              }
            }
            return;
          }
          if (name === 'HorizontalRule') {
            const line = doc.lineAt(node.from);
            if (!touches(line.from, line.to)) add(line.from, line.to, Decoration.replace({ widget: new HrWidget() }));
            return;
          }
          if (name === 'Table') { lineClass(node.from, node.to, 'cm-table'); return; }
          return;
        } });
      }
      return Decoration.set(marks.map(m => m.deco.range(m.from, m.to)), true);
    }
  }, { decorations: plugin => plugin.decorations });
}

function wrapSelection(mark: string) {
  return (view: EditorView) => {
    view.dispatch(view.state.changeByRange(range => {
      const { from, to } = range, n = mark.length;
      const before = view.state.sliceDoc(from - n, from), after = view.state.sliceDoc(to, to + n);
      if (from - n >= 0 && before === mark && after === mark) return { changes: [{ from: from - n, to: from }, { from: to, to: to + n }], range: EditorSelection.range(from - n, to - n) };
      const text = view.state.sliceDoc(from, to);
      if (text.length >= n * 2 && text.startsWith(mark) && text.endsWith(mark)) return { changes: { from, to, insert: text.slice(n, -n) }, range: EditorSelection.range(from, to - n * 2) };
      return { changes: [{ from, insert: mark }, { from: to, insert: mark }], range: EditorSelection.range(from + n, to + n) };
    }));
    return true;
  };
}
function insertLink(view: EditorView) {
  view.dispatch(view.state.changeByRange(range => {
    const text = view.state.sliceDoc(range.from, range.to);
    if (!text) return { changes: { from: range.from, insert: '[]()' }, range: EditorSelection.cursor(range.from + 1) };
    if (/^https?:\/\//i.test(text)) return { changes: { from: range.from, to: range.to, insert: `[](${text})` }, range: EditorSelection.cursor(range.from + 1) };
    return { changes: { from: range.from, to: range.to, insert: `[${text}]()` }, range: EditorSelection.cursor(range.to + 3) };
  }));
  return true;
}
function toggleLine(prefix: RegExp, insert: string) {
  return (view: EditorView) => {
    const changes: { from: number; to: number; insert: string }[] = [];
    const lines = new Set<number>();
    for (const range of view.state.selection.ranges) for (let n = view.state.doc.lineAt(range.from).number; n <= view.state.doc.lineAt(range.to).number; n++) lines.add(n);
    const all = [...lines].every(n => prefix.test(view.state.doc.line(n).text));
    for (const n of lines) {
      const line = view.state.doc.line(n);
      const match = prefix.exec(line.text);
      if (all && match) changes.push({ from: line.from, to: line.from + match[0].length, insert: '' });
      else if (!all && !match) changes.push({ from: line.from, to: line.from, insert });
    }
    view.dispatch({ changes });
    return true;
  };
}
export const commands = {
  bold: wrapSelection('**'), italic: wrapSelection('*'), strike: wrapSelection('~~'), code: wrapSelection('`'), highlight: wrapSelection('=='), link: insertLink,
  bullet: toggleLine(/^\s*[-*+]\s+(?!\[)/, '- '), task: toggleLine(/^\s*[-*+]\s+\[[ xX]\]\s*/, '- [ ] '), number: toggleLine(/^\s*\d+[.)]\s+/, '1. '), quote: toggleLine(/^\s*>\s?/, '> '),
  heading: (level: number) => (view: EditorView) => {
    const changes = view.state.selection.ranges.map(range => {
      const line = view.state.doc.lineAt(range.from);
      const current = /^(#{1,6})\s+/.exec(line.text);
      const currentLevel = current ? current[1].length : 0;
      const insert = currentLevel === level ? '' : '#'.repeat(level) + ' ';
      return { from: line.from, to: line.from + (current ? current[0].length : 0), insert };
    });
    view.dispatch({ changes });
    return true;
  },
};

// Enter on an empty list item or task ends the list, like Obsidian.
function endEmptyListItem(view: EditorView) {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const line = view.state.doc.lineAt(range.head);
  if (range.head !== line.to || !/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?$/.test(line.text)) return false;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: EditorSelection.cursor(line.from) });
  return true;
}

function wikiCompletion(host: () => EditorHost) {
  return (context: CompletionContext) => {
    const match = context.matchBefore(/\[\[([^\][\n]*)$/);
    if (!match) return null;
    const closed = context.state.sliceDoc(context.pos, context.pos + 2) === ']]';
    return { from: match.from + 2, validFor: /^[^\][\n]*$/, options: host().noteNames().map(name => ({ label: name, apply: closed ? name : `${name}]]` })) };
  };
}

async function insertFiles(view: EditorView, files: FileList | File[], host: EditorHost, pos?: number) {
  const images = [...files].filter(file => file.type.startsWith('image/'));
  if (!images.length) return false;
  for (const file of images) {
    const saved = await host.saveImage(file);
    if (!saved) continue;
    const at = pos ?? view.state.selection.main.head;
    view.dispatch({ changes: { from: at, insert: `![[${saved}]]` }, selection: EditorSelection.cursor(at + saved.length + 5) });
    pos = at + saved.length + 5;
  }
  return true;
}

export type NoteEditor = {
  view: EditorView;
  open(path: string, text: string): void;
  setMode(mode: Exclude<Mode, 'reading'>): void;
  text(): string;
  replaceText(text: string): void;
  goToLine(line: number): void;
  select(line: number, from: number, length: number): void;
  forget(path: string): void;
  rename(from: string, to: string): void;
  destroy(): void;
};

export function createEditor(parent: HTMLElement, host: () => EditorHost, initialMode: Exclude<Mode, 'reading'>): NoteEditor {
  const modeCompartment = new Compartment();
  const states = new Map<string, EditorState>();
  let current: string | null = null;
  const modeExtension = (mode: Exclude<Mode, 'reading'>): Extension => mode === 'live' ? livePreview(host) : [];
  const extensions: Extension = [
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    tabIndentation,
    markdown({ base: markdownLanguage, extensions: [wikiConfig], addKeymap: true }),
    syntaxHighlighting(highlightStyle),
    highlightSelectionMatches(),
    search({ top: true }),
    autocompletion({ override: [wikiCompletion(host)], icons: false, activateOnTyping: true }),
    modeCompartment.of(modeExtension(initialMode)),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences', 'aria-label': 'Note text' }),
    Prec.highest(keymap.of([
      { key: 'Enter', run: endEmptyListItem },
      { key: 'Mod-b', run: commands.bold }, { key: 'Mod-i', run: commands.italic }, { key: 'Mod-k', run: commands.link },
      { key: 'Mod-Shift-x', run: commands.strike }, { key: 'Mod-`', run: commands.code }, { key: 'Mod-Shift-h', run: commands.highlight },
      { key: 'Mod-l', run: commands.task }, { key: 'Mod-Shift-8', run: commands.bullet }, { key: 'Mod-Shift-7', run: commands.number }, { key: 'Mod-Shift-.', run: commands.quote },
    ])),
    keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || event.altKey || event.shiftKey) return false;
        const target = (event.target as HTMLElement).closest?.('.cm-wikilink, .cm-mdlink, .cm-tag') as HTMLElement | null;
        if (!target) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const revealed = view.state.selection.ranges.some(r => r.from <= pos + 1 && r.to >= pos - 1) && !(event.metaKey || event.ctrlKey);
        if (revealed && target.classList.contains('cm-wikilink') && view.state.sliceDoc(pos - 2, pos + 2).includes('[[')) return false;
        if (revealed && target.classList.contains('cm-mdlink')) return false;
        event.preventDefault();
        if (target.classList.contains('cm-tag')) host().openTag(target.dataset.tag || '');
        else if (target.classList.contains('cm-wikilink')) host().openLink(target.dataset.target || '');
        else if (target.dataset.href) host().openExternal(target.dataset.href);
        return true;
      },
      paste(event, view) {
        const files = event.clipboardData?.files;
        if (!files?.length || ![...files].some(f => f.type.startsWith('image/'))) return false;
        event.preventDefault();
        void insertFiles(view, files, host());
        return true;
      },
      drop(event, view) {
        const files = event.dataTransfer?.files;
        if (!files?.length || ![...files].some(f => f.type.startsWith('image/'))) return false;
        event.preventDefault();
        void insertFiles(view, files, host(), view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined);
        return true;
      },
    }),
    EditorView.updateListener.of(update => { if (update.docChanged && current) host().onChange(update.state.doc.toString()); }),
  ];
  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) });
  return {
    view,
    open(path, text) {
      if (current) states.set(current, view.state);
      const cached = states.get(path);
      current = path;
      if (cached && cached.doc.toString() === text) view.setState(cached);
      else view.setState(EditorState.create({ doc: text, extensions }));
    },
    setMode(mode) { view.dispatch({ effects: modeCompartment.reconfigure(modeExtension(mode)) }); },
    text() { return view.state.doc.toString(); },
    replaceText(text) {
      if (view.state.doc.toString() === text) return;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(head) });
    },
    goToLine(line) {
      const target = view.state.doc.line(Math.min(Math.max(1, line + 1), view.state.doc.lines));
      view.dispatch({ selection: EditorSelection.cursor(target.from), effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 24 }) });
      view.focus();
    },
    select(line, from, length) {
      const target = view.state.doc.line(Math.min(Math.max(1, line + 1), view.state.doc.lines));
      const start = Math.min(target.from + from, target.to);
      view.dispatch({ selection: EditorSelection.range(start, Math.min(start + length, target.to)), effects: EditorView.scrollIntoView(start, { y: 'center' }) });
      view.focus();
    },
    forget(path) { states.delete(path); if (current === path) current = null; },
    rename(from, to) { const state = states.get(from); if (state) { states.delete(from); states.set(to, state); } if (current === from) current = to; },
    destroy() { view.destroy(); },
  };
}
