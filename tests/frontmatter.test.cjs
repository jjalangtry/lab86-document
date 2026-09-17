const test = require('node:test');
const assert = require('node:assert/strict');

test('frontmatter keys are read, written, and kept for other tools', async () => {
  const fm = await import('../src/frontmatter.ts');
  const note = '---\ntitle: Essay\nfont: Georgia\nline-height: 2\n---\n# Body\n';
  const block = fm.parseFrontmatter(note);
  assert.equal(block.data.font, 'Georgia');
  assert.equal(note.slice(block.end), '# Body\n');
  assert.equal(fm.stripFrontmatter(note), '# Body\n');
  assert.equal(fm.stripFrontmatter('---\nno closing\n# Body'), '---\nno closing\n# Body');
  const format = fm.formatOf(note);
  assert.equal(format.font, 'Georgia');
  assert.equal(format.lineHeight, 2);
  assert.equal(format.align, 'left');
  const changed = fm.applyFormat(note, { align: 'justify', lineHeight: 1.6, pageNumbers: true });
  assert.equal(changed, '---\ntitle: Essay\nfont: Georgia\nalign: justify\npage-numbers: true\n---\n# Body\n');
  assert.equal(fm.applyFormat('# Plain\n', { font: 'Times New Roman' }), '---\nfont: Times New Roman\n---\n# Plain\n');
  assert.equal(fm.applyFormat('---\nfont: Georgia\n---\n# Plain\n', fm.DEFAULT_FORMAT), '# Plain\n');
  assert.equal(fm.formatOf('---\nfont-size: 900\nalign: sideways\n---\n').size, 12);
  assert.equal(fm.fontFamily('Arial'), '"Arial", sans-serif');
  assert.equal(fm.fontFamily('Garamond'), '"Garamond", serif');
});
