// Converts a Markdown note to a Word document. The note format from the frontmatter sets
// the font, size, line spacing, alignment, indent, paper, margins, and page numbers.
const { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, HeadingLevel, ImageRun, LevelFormat, PageNumber, PageOrientation, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = require('docx');
const { Marked, Lexer } = require('marked');
const { printOptions } = require('./export.cjs');

const PAGE = { Letter: [12240, 15840], A4: [11906, 16838], Legal: [12240, 20160] };
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const INLINE_HTML = /^<(\/?)(u|sub|sup|mark|ins|del|s|small|br)\s*\/?>$/i;
const ALIGNED_BLOCK = /^<(p|h[1-6]|div|center)(?:\s+align="(left|center|right|justify)")?\s*>([\s\S]*?)<\/\1>\s*$/;
const SPECIAL = /(!?\[\[[^\]\n]+\]\]|==[^=\n]+==)/g;

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return text;
  for (let i = 1; i < Math.min(lines.length, 500); i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return lines.slice(i + 1).join('\n');
  return text;
}

function docxBuffer(title, text, input = {}, images = {}) {
  const options = printOptions(input);
  const font = options.font || 'Calibri';
  const size = options.size * 2;
  const line = Math.round(options.lineHeight * 240);
  const alignment = ALIGN[options.align];
  const [pageWidth, pageHeight] = PAGE[options.pageSize];
  const marginTwips = Math.round(options.margin * 1440);
  const contentWidthPx = ((options.landscape ? pageHeight : pageWidth) - marginTwips * 2) / 1440 * 96;
  const marked = new Marked({ gfm: true });
  marked.use({ tokenizer: { code: () => undefined } });
  const lexer = new Lexer(marked.defaults);
  const numbering = [];
  let counter = 0;

  function image(target) {
    const file = images[target] || images[target.split('/').pop()];
    if (!file || !file.data || !['png', 'jpg'].includes(file.type)) return null;
    const scale = Math.min(1, contentWidthPx / (file.width || 600), 8 * 96 / (file.height || 400));
    return new ImageRun({ type: file.type, data: Buffer.from(file.data), transformation: { width: Math.round((file.width || 600) * scale), height: Math.round((file.height || 400) * scale) }, altText: { title: target, description: target, name: 'Image' } });
  }
  function run(value, style) {
    return new TextRun({ text: value, bold: style.bold || undefined, italics: style.italic || undefined, underline: style.underline ? {} : undefined, strike: style.strike || undefined, highlight: style.highlight ? 'yellow' : undefined, subScript: style.sub || undefined, superScript: style.sup || undefined, font: style.code ? 'Courier New' : undefined, shading: style.code ? { type: ShadingType.CLEAR, fill: 'F2F2F2' } : undefined });
  }
  function plainText(value, style, out) {
    let last = 0;
    for (const match of value.matchAll(SPECIAL)) {
      if (match.index > last) out.push(run(value.slice(last, match.index), style));
      const raw = match[0];
      if (raw.startsWith('==')) out.push(run(raw.slice(2, -2), { ...style, highlight: true }));
      else {
        const embed = raw.startsWith('!');
        const inner = raw.slice(embed ? 3 : 2, -2);
        const [targetPart, alias] = inner.split('|');
        const target = targetPart.replace(/#.*$/, '').trim();
        const picture = embed ? image(target) : null;
        if (picture) out.push(picture);
        else out.push(run(alias?.trim() || target || inner, { ...style, underline: !embed }));
      }
      last = match.index + raw.length;
    }
    if (last < value.length) out.push(run(value.slice(last), style));
  }
  // Inline tokens become runs. Inline HTML tags such as <u> switch a style on and off.
  function runs(tokens, style = {}) {
    const out = [];
    let current = { ...style };
    for (const token of tokens || []) {
      switch (token.type) {
        case 'text': if (token.tokens) out.push(...runs(token.tokens, current)); else plainText(token.text, current, out); break;
        case 'escape': out.push(run(token.text, current)); break;
        case 'strong': out.push(...runs(token.tokens, { ...current, bold: true })); break;
        case 'em': out.push(...runs(token.tokens, { ...current, italic: true })); break;
        case 'del': out.push(...runs(token.tokens, { ...current, strike: true })); break;
        case 'codespan': out.push(run(token.text, { ...current, code: true })); break;
        case 'br': out.push(new TextRun({ break: 1 })); break;
        case 'link': {
          const children = runs(token.tokens, { ...current, underline: true });
          if (/^(https?:\/\/|mailto:)/i.test(token.href)) out.push(new ExternalHyperlink({ link: token.href, children })); else out.push(...children);
          break;
        }
        case 'image': { const picture = image(decodeURIComponent(token.href)); out.push(picture || run(token.text || token.href, current)); break; }
        case 'html': {
          const tag = INLINE_HTML.exec(token.raw.trim());
          if (!tag) break;
          const name = tag[2].toLowerCase();
          if (name === 'br') { out.push(new TextRun({ break: 1 })); break; }
          const on = !tag[1];
          if (name === 'u' || name === 'ins') current = { ...current, underline: on };
          if (name === 'del' || name === 's') current = { ...current, strike: on };
          if (name === 'mark') current = { ...current, highlight: on };
          if (name === 'sub') current = { ...current, sub: on };
          if (name === 'sup') current = { ...current, sup: on };
          break;
        }
        default: if (token.tokens) out.push(...runs(token.tokens, current)); else if (token.text) plainText(token.text, current, out);
      }
    }
    return out;
  }
  const body = (children, extra = {}) => new Paragraph({ children, alignment, spacing: { after: options.indent ? 0 : Math.round(size * 5), line }, indent: options.indent ? { firstLine: 720 } : undefined, ...extra });
  const heading = (level, children, extra = {}) => new Paragraph({ children, heading: HeadingLevel[`HEADING_${level}`], spacing: { before: size * 6, after: size * 3, line: 276 }, ...extra });

  function blocks(tokens, context = {}) {
    const out = [];
    for (const token of tokens || []) {
      switch (token.type) {
        case 'space': break;
        case 'heading': out.push(heading(Math.min(token.depth, 6), runs(token.tokens))); break;
        case 'paragraph': case 'text': out.push(body(runs(token.tokens || lexer.inlineTokens(token.text || '')), context.list ? { numbering: context.list, indent: undefined, spacing: { after: 0, line } } : context.quote ? { indent: { left: 720, firstLine: 0 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } } } : {})); break;
        case 'html': {
          // The first line can be an aligned paragraph. Lines after it are normal text.
          const raw = token.raw.trim();
          const firstLine = raw.split('\n')[0];
          const match = ALIGNED_BLOCK.exec(firstLine);
          const rest = (match ? raw.slice(firstLine.length) : raw).replace(/<[^>]+>/g, '').trim();
          if (match) {
            const align = ALIGN[match[2] || (match[1] === 'center' ? 'center' : 'left')];
            const children = runs(lexer.inlineTokens(match[3].trim()));
            out.push(/^h[1-6]$/.test(match[1]) ? heading(Number(match[1][1]), children, { alignment: align }) : body(children, { alignment: align, indent: undefined }));
          }
          if (rest) out.push(body(runs(lexer.inlineTokens(rest))));
          break;
        }
        case 'list': {
          const reference = `list-${counter++}`;
          numbering.push({ reference, levels: Array.from({ length: 9 }, (_, level) => ({ level, format: token.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET, text: token.ordered ? `%${level + 1}.` : '•', start: Number(token.start) || 1, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1) + 360, hanging: 360 } } } })) });
          const level = Math.min((context.level ?? -1) + 1, 8);
          for (const item of token.items) {
            let first = true;
            const itemTokens = item.tokens.filter(child => child.type !== 'checkbox');
            if (item.task && itemTokens[0] && (itemTokens[0].type === 'text' || itemTokens[0].type === 'paragraph')) itemTokens[0] = { ...itemTokens[0], tokens: [{ type: 'text', raw: '', text: item.checked ? '☑ ' : '☐ ' }, ...(itemTokens[0].tokens || [])] };
            for (const child of itemTokens) {
              const nested = child.type === 'list';
              out.push(...blocks([child], { ...context, list: first && !nested ? { reference, level } : undefined, level: nested ? level : context.level, quote: false }));
              if (!nested) first = false;
            }
          }
          break;
        }
        case 'blockquote': out.push(...blocks(token.tokens, { ...context, quote: true })); break;
        case 'code': out.push(new Paragraph({ children: token.text.split('\n').flatMap((entry, index) => [...(index ? [new TextRun({ break: 1 })] : []), new TextRun({ text: entry, font: 'Courier New', size: Math.round(size * 0.85) })]), shading: { type: ShadingType.CLEAR, fill: 'F4F4F4' }, spacing: { after: size * 5, line: 240 } })); break;
        case 'hr': out.push(new Paragraph({ border: { bottom: { color: 'CCCCCC', size: 6, style: BorderStyle.SINGLE, space: 1 } }, spacing: { after: size * 5 } })); break;
        case 'table': {
          const cell = (entry, header) => new TableCell({ children: [new Paragraph({ children: runs(entry.tokens, { bold: header }), alignment: ALIGN[entry.align || 'left'] })], shading: header ? { type: ShadingType.CLEAR, fill: 'F2F2F2' } : undefined });
          out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: token.header.map(entry => cell(entry, true)) }), ...token.rows.map(row => new TableRow({ children: row.map(entry => cell(entry, false)) }))] }));
          out.push(new Paragraph({ spacing: { after: 0 } }));
          break;
        }
        default: if (token.tokens) out.push(...blocks(token.tokens, context));
      }
    }
    return out;
  }

  const children = [...(options.includeTitle ? [new Paragraph({ children: [new TextRun({ text: title, bold: true, size: size * 2 })], alignment: options.align === 'justify' ? AlignmentType.LEFT : alignment, spacing: { after: size * 6 } })] : []), ...blocks(marked.lexer(stripFrontmatter(text)))];
  const document = new Document({
    title,
    styles: {
      default: { document: { run: { font, size }, paragraph: { spacing: { line } } } },
      paragraphStyles: [1, 2, 3, 4, 5, 6].map(level => ({ id: `Heading${level}`, name: `Heading ${level}`, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, bold: true, size: Math.round(size * [0, 2, 1.5, 1.25, 1.1, 1, 1][level]), color: '1A1A1A' }, paragraph: { keepNext: true } })),
    },
    numbering: { config: numbering },
    sections: [{
      properties: { page: { size: { width: options.landscape ? pageHeight : pageWidth, height: options.landscape ? pageWidth : pageHeight, orientation: options.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: marginTwips, bottom: marginTwips, left: marginTwips, right: marginTwips } } },
      footers: options.pageNumbers ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })] }) } : undefined,
      children,
    }],
  });
  return Packer.toBuffer(document);
}

module.exports = { docxBuffer, stripFrontmatter };
