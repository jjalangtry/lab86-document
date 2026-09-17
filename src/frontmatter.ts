// Document format settings live in YAML frontmatter at the top of a note.
// Other tools keep the keys, and the note stays a plain Markdown file.

export type Align = 'left' | 'center' | 'right' | 'justify';
export type Paper = 'Letter' | 'A4' | 'Legal';
export type DocumentFormat = { font: string; size: number; lineHeight: number; align: Align; indent: boolean; paper: Paper; margin: number; pageNumbers: boolean };
export const DEFAULT_FORMAT: DocumentFormat = { font: '', size: 12, lineHeight: 1.6, align: 'left', indent: false, paper: 'Letter', margin: 1, pageNumbers: false };
export const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24];
export const LINE_HEIGHTS: [number, string][] = [[1, 'Single'], [1.15, '1.15'], [1.5, '1.5'], [1.6, 'Default'], [2, 'Double']];
export const MARGINS = [0.5, 0.75, 1, 1.25, 1.5];
export const PAPERS: Paper[] = ['Letter', 'A4', 'Legal'];
export const FONTS = ['Times New Roman', 'Georgia', 'Garamond', 'Cambria', 'Palatino', 'Book Antiqua', 'Arial', 'Helvetica', 'Calibri', 'Verdana', 'Inter', 'Courier New'];
const SANS = /arial|helvetica|calibri|verdana|inter|segoe|roboto|tahoma|trebuchet|gill|futura|avenir|open sans|lato|noto sans/i;
const MONO = /courier|mono|consolas|menlo|monaco/i;

const KEYS: Record<keyof DocumentFormat, string> = { font: 'font', size: 'font-size', lineHeight: 'line-height', align: 'align', indent: 'indent', paper: 'paper', margin: 'margin', pageNumbers: 'page-numbers' };

export type Frontmatter = { end: number; lines: string[]; data: Record<string, string> };

// Returns the frontmatter block at the start of the text. `end` is the offset after the closing line.
export function parseFrontmatter(text: string): Frontmatter | null {
  if (!text.startsWith('---')) return null;
  const firstBreak = text.indexOf('\n');
  if (firstBreak < 0 || text.slice(0, firstBreak).trim() !== '---') return null;
  const lines: string[] = [];
  let position = firstBreak + 1;
  for (let count = 0; count < 500 && position <= text.length; count++) {
    const next = text.indexOf('\n', position);
    const line = next < 0 ? text.slice(position) : text.slice(position, next);
    if (/^(---|\.\.\.)\s*$/.test(line)) {
      const data: Record<string, string> = {};
      for (const entry of lines) { const match = /^([\w-]+):\s*(.*)$/.exec(entry); if (match) data[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2'); }
      return { end: next < 0 ? text.length : next + 1, lines, data };
    }
    lines.push(line);
    if (next < 0) break;
    position = next + 1;
  }
  return null;
}

export const stripFrontmatter = (text: string) => { const block = parseFrontmatter(text); return block ? text.slice(block.end) : text; };

// Sets or removes keys. An undefined value removes the key. Other keys are kept.
export function setFrontmatterKeys(text: string, patch: Record<string, string | undefined>): string {
  const block = parseFrontmatter(text);
  const lines = block ? [...block.lines] : [];
  for (const [key, value] of Object.entries(patch)) {
    const index = lines.findIndex(line => line.startsWith(`${key}:`));
    if (value === undefined) { if (index >= 0) lines.splice(index, 1); continue; }
    const needsQuotes = /[:#'"]|^\s|\s$/.test(value);
    const rendered = `${key}: ${needsQuotes ? JSON.stringify(value) : value}`;
    if (index >= 0) lines[index] = rendered; else lines.push(rendered);
  }
  const body = block ? text.slice(block.end) : text;
  if (!lines.length) return body;
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

export function formatOf(text: string): DocumentFormat {
  const data = parseFrontmatter(text)?.data ?? {};
  const number = (value: string | undefined, fallback: number, min: number, max: number) => { const n = Number(value); return value !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : fallback; };
  const align = data[KEYS.align] as Align;
  const paper = data[KEYS.paper] as Paper;
  return {
    font: (data[KEYS.font] ?? '').replace(/["';]/g, '').slice(0, 80),
    size: number(data[KEYS.size], DEFAULT_FORMAT.size, 6, 72),
    lineHeight: number(data[KEYS.lineHeight], DEFAULT_FORMAT.lineHeight, 0.8, 4),
    align: ['left', 'center', 'right', 'justify'].includes(align) ? align : 'left',
    indent: data[KEYS.indent] === 'true',
    paper: PAPERS.includes(paper) ? paper : 'Letter',
    margin: number(data[KEYS.margin], DEFAULT_FORMAT.margin, 0, 3),
    pageNumbers: data[KEYS.pageNumbers] === 'true',
  };
}

// Writes a format change. Values equal to the default are removed from the frontmatter.
export function applyFormat(text: string, patch: Partial<DocumentFormat>): string {
  const keys: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(patch) as [keyof DocumentFormat, DocumentFormat[keyof DocumentFormat]][]) {
    keys[KEYS[name]] = value === DEFAULT_FORMAT[name] || value === '' ? undefined : String(value);
  }
  return setFrontmatterKeys(text, keys);
}

export const isDefaultFormat = (format: DocumentFormat) => (Object.keys(DEFAULT_FORMAT) as (keyof DocumentFormat)[]).every(key => format[key] === DEFAULT_FORMAT[key]);

export function fontFamily(font: string): string {
  if (!font) return '';
  const generic = MONO.test(font) ? 'monospace' : SANS.test(font) ? 'sans-serif' : 'serif';
  return `"${font.replace(/"/g, '')}", ${generic}`;
}

export function formatSummary(format: DocumentFormat): string {
  const parts = [format.font || 'Default font', `${format.size} pt`, LINE_HEIGHTS.find(([value]) => value === format.lineHeight)?.[1] ?? String(format.lineHeight)];
  if (format.align !== 'left') parts.push(format.align);
  parts.push(format.paper);
  return parts.join(' · ');
}
