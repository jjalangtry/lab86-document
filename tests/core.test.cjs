const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault, checkName } = require('../electron/vault.cjs');
const { inlineImages, printDocument, printOptions } = require('../electron/export.cjs');

async function withVault(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'document-vault-'));
  try { await callback(new Vault(directory), directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('paths outside the vault are rejected', async () => {
  await withVault(async vault => {
    assert.throws(() => vault.resolve('../outside.md'));
    assert.throws(() => vault.resolve('notes/../../outside.md'));
    assert.equal(vault.resolve('/notes/a.md'), path.join(vault.root, 'notes', 'a.md'));
    assert.equal(vault.resolve(''), vault.root);
    await assert.rejects(vault.read('../outside.md'));
    await assert.rejects(vault.write('secret.txt', 'x'), /Markdown/);
  });
});

test('names with reserved characters are rejected', () => {
  for (const name of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', 'a#b', 'a[b]', '.hidden', ' ']) assert.throws(() => checkName(name), name);
  assert.equal(checkName('Meeting notes 2026'), 'Meeting notes 2026');
});

test('notes are created with unique names, listed as a tree, and written atomically', async () => {
  await withVault(async (vault, directory) => {
    const first = await vault.createNote('', 'Untitled');
    const second = await vault.createNote('', 'Untitled');
    assert.equal(first, 'Untitled.md');
    assert.equal(second, 'Untitled 1.md');
    const folder = await vault.createFolder('', 'Projects');
    const nested = await vault.createNote(folder, 'Plan', '# Plan\n');
    assert.equal(nested, 'Projects/Plan.md');
    await fs.writeFile(path.join(directory, 'diagram.png'), Buffer.from([137, 80, 78, 71]));
    await fs.writeFile(path.join(directory, 'ignored.txt'), 'x');
    await fs.mkdir(path.join(directory, '.obsidian'));
    const tree = await vault.tree();
    assert.deepEqual(tree.map(e => [e.kind, e.path]), [['folder', 'Projects'], ['file', 'diagram.png'], ['note', 'Untitled.md'], ['note', 'Untitled 1.md']]);
    assert.deepEqual(tree[0].children.map(e => e.path), ['Projects/Plan.md']);
    await Promise.all([vault.write(first, 'one'), vault.write(first, 'two'), vault.write(first, 'three')]);
    assert.equal(await vault.read(first), 'three');
    assert.ok(!(await fs.readdir(directory)).some(f => f.endsWith('.tmp')));
    const index = await vault.index();
    assert.equal(index.find(n => n.path === nested).text, '# Plan\n');
  });
});

test('rename keeps the extension and refuses to replace an existing item', async () => {
  await withVault(async vault => {
    await vault.createNote('', 'A', 'a');
    await vault.createNote('', 'B', 'b');
    await assert.rejects(vault.rename('A.md', 'B.md'), /exists/);
    await assert.rejects(vault.rename('A.md', 'A.txt'), /extension/);
    assert.equal(await vault.rename('A.md', 'Archive/C.md'), 'Archive/C.md');
    assert.equal(await vault.read('Archive/C.md'), 'a');
    assert.equal(await vault.exists('A.md'), false);
  });
});

test('attachments are stored in the attachments folder with unique names', async () => {
  await withVault(async vault => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(await vault.saveAttachment('Pasted image.png', bytes), 'attachments/Pasted image.png');
    assert.equal(await vault.saveAttachment('Pasted image.png', bytes), 'attachments/Pasted image 1.png');
    await assert.rejects(vault.saveAttachment('script.js', bytes), /image/);
    await assert.rejects(vault.saveAttachment('empty.png', Buffer.alloc(0)));
  });
});

test('PDF export inlines vault images and escapes the title', async () => {
  await withVault(async (vault, directory) => {
    await fs.mkdir(path.join(directory, 'attachments'));
    await fs.writeFile(path.join(directory, 'attachments', 'a b.png'), Buffer.from([1, 2, 3]));
    const body = '<p>Text</p><img src="vault://local/attachments/a%20b.png"><img src="vault://local/../etc/passwd"><img src="vault://local/missing.png">';
    const inlined = await inlineImages(body, vault);
    assert.ok(inlined.includes('src="data:image/png;base64,AQID"'));
    assert.ok(!inlined.includes('vault://'));
    assert.equal((inlined.match(/src=""/g) || []).length, 2);
    const html = printDocument('<Title> & "quotes"', inlined, { pageSize: 'A4', margin: 'minimal', landscape: true });
    assert.ok(html.includes('<title>&lt;Title&gt; &amp; &quot;quotes&quot;</title>'));
    assert.ok(html.includes('size: A4 landscape; margin: 0.5in'));
    assert.ok(html.includes('class="print-title"'));
    assert.ok(!printDocument('T', '', { includeTitle: false }).includes('class="print-title"'));
    assert.deepEqual(printOptions({ pageSize: 'Tabloid', margin: 'huge' }), { pageSize: 'Letter', margin: 1, landscape: false, includeTitle: true });
  });
});

test('the tree watcher reports changes inside folders that appear later', async () => {
  const { TreeWatcher } = require('../electron/watcher.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'document-watch-'));
  const batches = [];
  const watcher = new TreeWatcher(directory, changed => batches.push(changed), { delay: 100 });
  const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    await watcher.ready;
    await fs.mkdir(path.join(directory, 'Ideas'));
    await settle(250);
    await fs.writeFile(path.join(directory, 'Ideas', 'Third.md'), 'a');
    await settle(250);
    await fs.writeFile(path.join(directory, 'Ideas', 'Third.md'), 'b');
    await fs.writeFile(path.join(directory, '.hidden.md'), 'x');
    await settle(400);
    const seen = batches.flat();
    assert.ok(seen.includes('Ideas'), JSON.stringify(batches));
    assert.ok(seen.filter(p => p === 'Ideas/Third.md').length >= 2, JSON.stringify(batches));
    assert.ok(!seen.includes('.hidden.md'));
  } finally { watcher.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
