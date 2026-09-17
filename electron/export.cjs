const fs = require('node:fs/promises');
const path = require('node:path');
const { isImage } = require('./vault.cjs');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif' };
const PAGE_SIZES = new Set(['Letter', 'A4', 'Legal']);
const ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const SANS = /arial|helvetica|calibri|verdana|inter|segoe|roboto|tahoma|trebuchet|gill|futura|avenir|open sans|lato|noto sans/i;
const MONO = /courier|mono|consolas|menlo|monaco/i;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Replaces vault:// image sources with data URLs so the print page needs no vault access.
async function inlineImages(html, vault) {
  const pattern = /src="vault:\/\/local\/([^"]*)"/g;
  const matches = [...html.matchAll(pattern)];
  const replacements = new Map();
  for (const match of matches) {
    if (replacements.has(match[0])) continue;
    let replacement = 'src=""';
    try {
      const relative = decodeURIComponent(match[1]);
      const full = vault.resolve(relative);
      if (isImage(full) && (await fs.stat(full)).size <= 25_000_000) {
        const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
        replacement = `src="data:${type};base64,${(await fs.readFile(full)).toString('base64')}"`;
      }
    } catch { /* unreadable images print as empty */ }
    replacements.set(match[0], replacement);
  }
  return html.replace(pattern, found => replacements.get(found) || 'src=""');
}

const clamp = (value, fallback, min, max) => (Number.isFinite(Number(value)) && value !== null && value !== '' && Number(value) >= min && Number(value) <= max ? Number(value) : fallback);
function printOptions(input = {}) {
  const pageSize = PAGE_SIZES.has(input.pageSize) ? input.pageSize : 'Letter';
  const font = typeof input.font === 'string' ? input.font.replace(/["';\\]/g, '').slice(0, 80).trim() : '';
  return {
    pageSize, margin: clamp(input.margin, 1, 0, 3), landscape: input.landscape === true, includeTitle: input.includeTitle !== false,
    font, size: clamp(input.size, 12, 6, 72), lineHeight: clamp(input.lineHeight, 1.5, 0.8, 4),
    align: ALIGNS.has(input.align) ? input.align : 'left', indent: input.indent === true, pageNumbers: input.pageNumbers === true,
  };
}
const fontFamily = font => font ? `"${font}", ${MONO.test(font) ? 'monospace' : SANS.test(font) ? 'sans-serif' : 'serif'}` : '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif';

function printDocument(title, body, options) {
  const { pageSize, margin, landscape, includeTitle, font, size, lineHeight, align, indent } = printOptions(options);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
  @page { size: ${pageSize} ${landscape ? 'landscape' : 'portrait'}; margin: ${margin}in; }
  html { font-family: ${fontFamily(font)}; font-size: ${size}pt; line-height: ${lineHeight}; color: #1a1a1a; }
  body { margin: 0; overflow-wrap: break-word; text-align: ${align}; }
  ${indent ? 'p { text-indent: 2em; } li > p, .print-title + p { text-indent: 0; }' : ''}
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 .5em; break-after: avoid; font-weight: 700; }
  h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; } h5, h6 { font-size: 1em; }
  body > :first-child { margin-top: 0; }
  p { margin: 0 0 ${indent ? '0' : '.9em'}; orphans: 2; widows: 2; }
  ul, ol { padding-left: 1.6em; margin: 0 0 .9em; } li { margin: .15em 0; } li > p { margin: 0; }
  li.task-list-item { list-style: none; margin-left: -1.4em; }
  input[type=checkbox] { margin: 0 .5em 0 0; vertical-align: -1px; }
  blockquote { margin: 0 0 .9em; padding: .1em 0 .1em 1em; border-left: 3px solid #bbb; color: #444; }
  pre { font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: .85em; background: #f4f4f4; border-radius: 4px; padding: .8em 1em; white-space: pre-wrap; break-inside: avoid; }
  code { font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: .9em; background: #f1f1f1; border-radius: 3px; padding: .1em .3em; }
  pre code { background: none; padding: 0; font-size: inherit; }
  img { max-width: 100%; max-height: 8in; object-fit: contain; break-inside: avoid; }
  a { color: #1a1a1a; text-decoration: underline; }
  a.internal-link { text-decoration: none; }
  a.tag { color: #666; text-decoration: none; }
  hr { border: 0; border-top: 1px solid #ccc; margin: 1.5em 0; }
  table { border-collapse: collapse; margin: 0 0 .9em; width: 100%; }
  th, td { border: 1px solid #ccc; padding: .35em .6em; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  .print-title { font-size: 2em; margin: 0 0 .6em; text-align: ${align === 'justify' ? 'left' : align}; }
</style></head><body>${includeTitle ? `<h1 class="print-title">${esc(title)}</h1>` : ''}${body}</body></html>`;
}

module.exports = { inlineImages, printDocument, printOptions, esc };
