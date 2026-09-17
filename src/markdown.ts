import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import type { Note } from './types';
import { stripFrontmatter } from './frontmatter';

export const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
export const isImagePath = (path: string) => IMAGE_EXTENSION.test(path);
export const isNotePath = (path: string) => /\.md$/i.test(path);
export const noteStem = (path: string) => path.replace(/\.md$/i, '');
export const noteName = (path: string) => noteStem(path).split('/').pop() || '';
export const folderOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const vaultUrl = (path: string) => 'vault://local/' + path.split('/').map(encodeURIComponent).join('/');
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const isExternal = (href: string) => /^(https?:\/\/|mailto:)/i.test(href);

export type Resolver = (target: string, fromPath?: string) => string | null;

function joinRelative(fromPath: string, href: string) {
  const parts = folderOf(fromPath) ? folderOf(fromPath).split('/') : [];
  for (const part of href.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

// Resolves link targets like Obsidian: an exact path first, then the shortest path with that name.
export function makeResolver(paths: string[]): Resolver {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const path of paths) {
    byPath.set(path.toLowerCase(), path);
    if (isNotePath(path)) byPath.set(noteStem(path).toLowerCase(), path);
    const name = (isNotePath(path) ? noteName(path) : path.split('/').pop() || '').toLowerCase();
    const list = byName.get(name) || [];
    list.push(path);
    byName.set(name, list);
  }
  return (rawTarget, fromPath) => {
    const target = rawTarget.trim().replace(/^\.?\//, '');
    if (!target) return null;
    const key = target.toLowerCase();
    if (fromPath && (target.startsWith('./') || target.startsWith('../') || target.includes('/'))) {
      const joined = joinRelative(fromPath, target).toLowerCase();
      if (byPath.has(joined)) return byPath.get(joined) as string;
    }
    if (byPath.has(key)) return byPath.get(key) as string;
    const name = key.split('/').pop() || '';
    const candidates = byName.get(name) || byName.get(name.replace(/\.md$/, ''));
    if (!candidates?.length) return null;
    return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  };
}

export type WikiTarget = { target: string; heading: string; alias: string; embed: boolean };
export const WIKI_PATTERN = /(!?)\[\[([^\][|#]*)(#[^\][|]*)?(?:\|([^\][]*))?\]\]/g;
export function parseWiki(match: RegExpMatchArray): WikiTarget {
  return { embed: match[1] === '!', target: match[2].trim(), heading: (match[3] || '').slice(1).trim(), alias: (match[4] || '').trim() };
}

const wikilink = (resolve: Resolver, notePath: string): TokenizerAndRendererExtension => ({
  name: 'wikilink', level: 'inline',
  start(src) { const index = src.search(/!?\[\[/); return index < 0 ? undefined : index; },
  tokenizer(src) {
    const match = /^(!?)\[\[([^\][|#]*)(#[^\][|]*)?(?:\|([^\][]*))?\]\]/.exec(src);
    if (!match) return undefined;
    const link = parseWiki(match);
    if (!link.target && !link.heading) return undefined;
    return { type: 'wikilink', raw: match[0], ...link };
  },
  renderer(token) {
    const link = token as unknown as WikiTarget;
    const resolved = link.target ? resolve(link.target, notePath) : notePath;
    if (link.embed && resolved && isImagePath(resolved)) return `<img src="${vaultUrl(resolved)}" alt="${escapeHtml(link.alias || link.target)}">`;
    const label = link.alias || (link.target ? link.target + (link.heading ? ` › ${link.heading}` : '') : link.heading);
    return `<a class="internal-link${resolved ? '' : ' is-unresolved'}" data-href="${escapeHtml(resolved || link.target)}"${link.heading ? ` data-heading="${escapeHtml(link.heading)}"` : ''}>${escapeHtml(label)}</a>`;
  },
});

const TAG_BODY = /^[\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*/u;
const tag: TokenizerAndRendererExtension = {
  name: 'tag', level: 'inline',
  start(src) { const match = /(?:^|\s)#[\p{L}\p{N}_/-]/u.exec(src); return match ? match.index + match[0].length - 2 : undefined; },
  tokenizer(src, tokens) {
    if (!src.startsWith('#')) return undefined;
    const previous = tokens[tokens.length - 1]?.raw ?? '';
    if (previous && !/\s$/.test(previous)) return undefined;
    const match = TAG_BODY.exec(src.slice(1));
    if (!match) return undefined;
    return { type: 'tag', raw: '#' + match[0], name: match[0] };
  },
  renderer(token) { return `<a class="tag" data-tag="${escapeHtml(token.name)}">#${escapeHtml(token.name)}</a>`; },
};

const highlight: TokenizerAndRendererExtension = {
  name: 'highlight', level: 'inline',
  start(src) { const index = src.indexOf('=='); return index < 0 ? undefined : index; },
  tokenizer(src) {
    const match = /^==([^=\n]+?)==/.exec(src);
    if (!match) return undefined;
    return { type: 'highlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
  },
  renderer(token) { return `<mark>${this.parser.parseInline(token.tokens || [])}</mark>`; },
};

// <p align="center">…</p> and <h1 align="right">…</h1> blocks keep inline Markdown inside them.
const alignedBlock: TokenizerAndRendererExtension = {
  name: 'alignedBlock', level: 'block',
  start(src) { const match = /^<(?:p|h[1-6]|div|center)\b/m.exec(src); return match ? match.index : undefined; },
  tokenizer(src) {
    const match = /^<(p|h[1-6]|div|center)(?:\s+align="(left|center|right|justify)")?\s*>([\s\S]*?)<\/\1>[ \t]*(?:\n+|$)/.exec(src);
    if (!match) return undefined;
    return { type: 'alignedBlock', raw: match[0], tag: /^h[1-6]$/.test(match[1]) ? match[1] : 'p', align: match[2] || (match[1] === 'center' ? 'center' : 'left'), tokens: this.lexer.inlineTokens(match[3].trim()) };
  },
  renderer(token) { return `<${token.tag} style="text-align:${token.align}">${this.parser.parseInline(token.tokens || [])}</${token.tag}>\n`; },
};

export function renderMarkdown(source: string, notePath: string, resolve: Resolver): string {
  const text = stripFrontmatter(source);
  const marked = new Marked({ gfm: true, breaks: false, extensions: [alignedBlock, wikilink(resolve, notePath), tag, highlight] });
  marked.use({
    renderer: {
      link(token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        if (isExternal(token.href)) return `<a href="${escapeHtml(token.href)}" class="external-link" title="${escapeHtml(token.title || token.href)}">${inner}</a>`;
        let decoded = token.href;
        try { decoded = decodeURIComponent(token.href); } catch { /* keep as typed */ }
        const resolved = resolve(decoded.replace(/#.*$/, ''), notePath);
        return `<a class="internal-link${resolved ? '' : ' is-unresolved'}" data-href="${escapeHtml(resolved || decoded)}">${inner}</a>`;
      },
      image(token: Tokens.Image) {
        if (isExternal(token.href)) return `<span class="missing-image">${escapeHtml(token.text || token.href)}</span>`;
        let decoded = token.href;
        try { decoded = decodeURIComponent(token.href); } catch { /* keep as typed */ }
        const resolved = resolve(decoded, notePath);
        if (!resolved || !isImagePath(resolved)) return `<span class="missing-image">${escapeHtml(token.text || token.href)}</span>`;
        return `<img src="${vaultUrl(resolved)}" alt="${escapeHtml(token.text)}"${token.title ? ` title="${escapeHtml(token.title)}"` : ''}>`;
      },
    },
  });
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-href', 'data-heading', 'data-tag'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|vault):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_TAGS: ['style', 'form', 'button', 'select', 'textarea', 'iframe', 'object', 'embed'],
  });
}

export type Heading = { level: number; text: string; line: number };
export function outline(text: string): Heading[] {
  const headings: Heading[] = [];
  let fenced = false;
  const skip = text.length - stripFrontmatter(text).length;
  const offset = skip ? text.slice(0, skip).split('\n').length - 1 : 0;
  stripFrontmatter(text).split('\n').forEach((raw, index) => {
    const line = index + offset;
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; return; }
    if (fenced) return;
    const aligned = /^<h([1-6])(?:\s+align="\w+")?>([\s\S]*)<\/h\1>\s*$/.exec(raw);
    if (aligned) { headings.push({ level: Number(aligned[1]), text: aligned[2].replace(/<[^>]+>/g, '').replace(/[*_`~]/g, ''), line }); return; }
    const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (match) headings.push({ level: match[1].length, text: match[2].replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_m, a, b) => b || a).replace(/[*_`~]/g, ''), line });
  });
  return headings;
}

export function countWords(source: string) {
  const text = stripFrontmatter(source).replace(/<\/?[a-z][^>]*>/gi, '');
  const words = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return { words, characters: text.length };
}

export type Backlink = { path: string; lines: { line: number; text: string }[] };
// Finds notes that link to the target note. Links are resolved the same way as when rendered.
export function backlinks(target: string, notes: Note[], resolve: Resolver): Backlink[] {
  const result: Backlink[] = [];
  for (const note of notes) {
    if (note.path === target) continue;
    const lines: Backlink['lines'] = [];
    note.text.split('\n').forEach((text, line) => {
      let found = false;
      for (const match of text.matchAll(WIKI_PATTERN)) {
        const link = parseWiki(match);
        if (link.target && resolve(link.target, note.path) === target) found = true;
      }
      for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        if (!isExternal(match[1])) {
          let decoded = match[1];
          try { decoded = decodeURIComponent(match[1]); } catch { /* keep as typed */ }
          if (resolve(decoded.replace(/#.*$/, ''), note.path) === target) found = true;
        }
      }
      if (found) lines.push({ line, text: text.trim() });
    });
    if (lines.length) result.push({ path: note.path, lines });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export type SearchHit = { path: string; matches: { line: number; text: string; from: number; length: number }[]; total: number };
export function searchNotes(query: string, notes: Note[]): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const note of notes) {
    const matches: SearchHit['matches'] = [];
    let total = 0;
    if (noteStem(note.path).toLowerCase().includes(needle)) total++;
    note.text.split('\n').forEach((text, line) => {
      const index = text.toLowerCase().indexOf(needle);
      if (index < 0) return;
      total++;
      if (matches.length < 6) matches.push({ line, text: text.trim(), from: index - (text.length - text.trimStart().length), length: needle.length });
    });
    if (total) hits.push({ path: note.path, matches, total });
  }
  return hits.sort((a, b) => b.total - a.total || a.path.localeCompare(b.path)).slice(0, 200);
}

// A small fuzzy matcher for the quick switcher and the command palette. Higher is better.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase(), t = text.toLowerCase();
  if (!q) return 0;
  const exact = t.indexOf(q);
  if (exact >= 0) return 1000 - exact - (t.length - q.length) * 0.1 + (exact === 0 || /[\s/_-]/.test(t[exact - 1]) ? 50 : 0);
  let score = 0, position = 0, streak = 0;
  for (const char of q) {
    const index = t.indexOf(char, position);
    if (index < 0) return null;
    streak = index === position ? streak + 1 : 0;
    score += 10 + streak * 5 + (index === 0 || /[\s/_-]/.test(t[index - 1]) ? 8 : 0) - (index - position) * 0.5;
    position = index + 1;
  }
  return score - t.length * 0.05;
}
