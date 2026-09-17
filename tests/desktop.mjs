import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';

const data = await fs.mkdtemp(path.join(os.tmpdir(), 'document-desktop-'));
const vault = path.join(data, 'Vault');
const output = path.resolve('.test-output');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(vault, { recursive: true });
await fs.writeFile(path.join(data, 'config.json'), JSON.stringify({ vault, recent: [vault], theme: 'dark' }));
let app;
const errors = [];
const launch = () => electron.launch({ args: [process.env.LABDOC_TEST_APP || '.', '--no-sandbox', '--disable-gpu'], env: { ...process.env, LABDOC_TEST_DATA: data }, timeout: 30000 });
const read = name => fs.readFile(path.join(vault, name), 'utf8');
try {
  app = await launch();
  let page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByText('No note is open')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'empty.png') });

  // New note: the title gets focus, Enter moves to the editor.
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  const title = page.getByRole('textbox', { name: 'Note title' });
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('Untitled');
  await page.keyboard.type('First note');
  await page.keyboard.press('Enter');
  const body = page.locator('.cm-content');
  await expect(body).toBeFocused();
  await expect(page.getByRole('treeitem', { name: 'First note' })).toBeVisible();
  await expect.poll(() => fs.readdir(vault)).toContain('First note.md');

  // Live preview hides Markdown marks on other lines and shows them on the cursor line.
  await page.keyboard.type('# Heading one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Some **bold** words and a [[Second note]] link. #topic');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] a task');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain line');
  await expect(body.locator('.cm-line.cm-h1')).toHaveText('Heading one');
  await expect(body.locator('.cm-wikilink')).toHaveText('Second note');
  await expect(body.locator('.cm-wikilink')).toHaveClass(/is-unresolved/);
  await expect(body.locator('.cm-tag')).toHaveText('#topic');
  await expect(body.locator('input.cm-task')).toHaveCount(1);
  await expect.poll(() => read('First note.md')).toContain('Some **bold** words and a [[Second note]] link. #topic');
  await page.screenshot({ path: path.join(output, 'live-preview.png') });

  // Word count in the status bar.
  await expect(page.getByRole('status').filter({ hasText: /words/ })).toContainText('15 words');

  // Clicking a task toggles it in the file.
  await body.locator('input.cm-task').click();
  await expect.poll(() => read('First note.md')).toContain('- [x] a task');

  // Clicking an unresolved wikilink creates the note. Backlinks show the source.
  await body.locator('.cm-wikilink').click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Second note');
  await expect.poll(() => fs.readdir(vault)).toContain('Second note.md');
  await page.getByRole('button', { name: /Show right sidebar/ }).click();
  await page.getByRole('button', { name: 'Backlinks', exact: true }).click();
  await expect(page.locator('.sidebar-right .search-hit-title')).toHaveText(/First note/);
  await page.locator('.sidebar-right .search-hit-title').click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('First note');
  await expect(page.locator('.cm-wikilink')).not.toHaveClass(/is-unresolved/);

  // Outline lists the heading. Back and forward navigate history.
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(page.locator('.outline-item')).toHaveText('Heading one');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Second note');
  await page.getByRole('button', { name: 'Forward', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('First note');

  // Reading view renders HTML. Escape is not possible for scripts.
  await page.getByTestId('mode-toggle').click();
  const article = page.getByRole('article', { name: 'Note preview' });
  await expect(article.locator('h1')).toHaveText('Heading one');
  await expect(article.locator('strong')).toHaveText('bold');
  await expect(article.locator('a.internal-link')).toHaveText('Second note');
  await expect(article.locator('input[type=checkbox]')).toBeChecked();
  await page.screenshot({ path: path.join(output, 'reading.png') });
  await article.locator('input[type=checkbox]').click();
  await expect.poll(() => read('First note.md')).toContain('- [ ] a task');
  await page.getByTestId('mode-toggle').click();
  await expect(body).toBeVisible();

  // Document format settings go to the frontmatter and apply to the editor.
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption('Georgia');
  await page.getByRole('combobox', { name: 'Line spacing' }).selectOption('2');
  await page.getByRole('group', { name: 'Alignment' }).getByRole('button', { name: 'Justify' }).click();
  await page.getByRole('checkbox', { name: 'Page numbers in the PDF' }).check();
  await expect.poll(() => read('First note.md')).toMatch(/^---\nfont: Georgia\nline-height: 2\nalign: justify\npage-numbers: true\n---\n# Heading one/);
  await expect(page.locator('.cm-frontmatter')).toHaveText('Georgia · 12 pt · Double · justify · Letter');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.cm-content .cm-line:not(.cm-heading):not(.cm-task-line)')).textAlign)).toBe('justify');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')).fontFamily)).toContain('Georgia');

  // The toolbar writes underline tags and aligned paragraphs. Live preview hides the tags.
  const formatting = page.getByRole('toolbar', { name: 'Formatting', exact: true });
  await body.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await formatting.getByRole('button', { name: /^Underline/ }).click();
  await expect.poll(() => read('First note.md')).toContain('<u>Plain line</u>');
  await formatting.getByRole('button', { name: /^Align center/ }).click();
  await expect.poll(() => read('First note.md')).toContain('<p align="center"><u>Plain line</u></p>');
  await page.keyboard.press('Control+Home');
  await expect(body.locator('.cm-line.cm-align-center')).toHaveCount(1);

  // Highlight from the toolbar renders in the live preview. The selection toolbar floats above selected text.
  const selectWords = async (count, skip = 0) => {
    await body.locator('.cm-line.cm-h1').click();
    await page.keyboard.press('End');
    for (let i = 0; i < skip; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < count; i++) await page.keyboard.press('Shift+ArrowLeft');
  };
  await selectWords('Heading one'.length);
  await expect(page.getByRole('toolbar', { name: 'Selection formatting' })).toBeVisible();
  await formatting.getByRole('button', { name: /^Highlight/ }).click();
  await expect.poll(() => read('First note.md')).toContain('# ==Heading one==');
  await body.locator('.cm-line').last().click();
  await expect(body.locator('.cm-highlight')).toHaveText('Heading one');
  await expect(body).not.toContainText('==');
  await selectWords('Heading one'.length, 2);
  await page.getByRole('toolbar', { name: 'Selection formatting' }).getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect.poll(() => read('First note.md')).toContain('# Heading one');
  await expect(page.getByRole('toolbar', { name: 'Selection formatting' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('toolbar', { name: 'Selection formatting' })).toBeHidden();

  // Indented text stays a paragraph in both views.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('\tIndented sentence.');
  await expect(body.locator('.cm-line.cm-codeblock')).toHaveCount(0);
  await page.getByTestId('mode-toggle').click();
  await expect(article.locator('pre')).toHaveCount(0);
  await expect(article).toContainText('Indented sentence.');
  await page.getByTestId('mode-toggle').click();
  await expect(body.locator('.cm-html-u')).toHaveText('Plain line');
  await expect(body).not.toContainText('<u>');
  await page.getByTestId('mode-toggle').click();
  await expect(article.locator('p[style*="center"] u')).toHaveText('Plain line');
  await page.getByTestId('mode-toggle').click();

  // Rename through the title updates the file and the link in the other note.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Second note');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Renamed note');
  await page.keyboard.press('Enter');
  await expect.poll(() => fs.readdir(vault)).toContain('Renamed note.md');
  await expect.poll(() => read('First note.md')).toContain('[[Renamed note]]');
  await expect(page.getByRole('treeitem', { name: 'Renamed note' })).toBeVisible();

  // Search finds text across notes and opens the match.
  await page.keyboard.press('Control+Shift+F');
  const search = page.getByRole('textbox', { name: 'Search all notes' });
  await expect(search).toBeFocused();
  await search.fill('a task');
  await expect(page.locator('.search-match')).toHaveCount(1);
  await page.locator('.search-match').click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('First note');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('a task');

  // Quick switcher opens by name and creates by name.
  await page.keyboard.press('Control+o');
  const switcher = page.getByRole('combobox', { name: 'Find or create a note…' });
  await expect(switcher).toBeFocused();
  await switcher.fill('renamed');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Renamed note');
  await page.keyboard.press('Control+o');
  await page.getByRole('combobox', { name: 'Find or create a note…' }).fill('Ideas/Third');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Third');
  await expect.poll(() => fs.readdir(path.join(vault, 'Ideas'))).toContain('Third.md');

  // Command palette runs a command.
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Select a command…' }).fill('source mode');
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').click();
  await page.keyboard.type('**raw**');
  await expect(page.locator('.cm-content')).toContainText('**raw**');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```js\nconst a = 1;\n```\n---\n> quoted');
  await expect.poll(() => read('Ideas/Third.md')).toContain('```js\nconst a = 1;\n```');
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Select a command…' }).fill('live preview');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-line.cm-codeblock')).toHaveCount(3);
  await expect(page.locator('.cm-line.cm-quote')).toHaveCount(1);
  await expect(page.locator('hr.cm-hr')).toHaveCount(1);

  // External changes on disk appear in the editor. The app's own save must finish first.
  await expect.poll(() => read('Ideas/Third.md')).toContain('> quoted');
  await fs.writeFile(path.join(vault, 'Ideas', 'Third.md'), 'Changed outside the app.\n');
  await expect(page.locator('.cm-content')).toContainText('Changed outside the app.', { timeout: 10000 });

  // PDF export.
  await page.keyboard.press('Control+o');
  await page.getByRole('combobox', { name: 'Find or create a note…' }).fill('First');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('First note');
  await app.evaluate(({ dialog }, directory) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${directory}/export.pdf` }); }, data);
  await page.keyboard.press('Control+Shift+E');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Exported export.pdf' })).toBeVisible({ timeout: 20000 });
  const pdfTask = getDocument({ data: new Uint8Array(await fs.readFile(path.join(data, 'export.pdf'))), useSystemFonts: true });
  const pdf = await pdfTask.promise;
  const pdfText = (await (await pdf.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
  expect(pdfText).toContain('First note');
  expect(pdfText).toContain('Heading one');
  await pdfTask.destroy();
  await fs.copyFile(path.join(data, 'export.pdf'), path.join(output, 'export.pdf'));

  // Word export.
  await app.evaluate(({ dialog }, directory) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${directory}/export.docx` }); }, data);
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Select a command…' }).fill('export to word');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Exported export.docx' })).toBeVisible({ timeout: 20000 });
  const word = await JSZip.loadAsync(await fs.readFile(path.join(data, 'export.docx')));
  const wordXml = await word.file('word/document.xml').async('string');
  expect(wordXml).toContain('Heading one');
  expect(wordXml).toContain('<w:u w:val="single"/>');
  expect(wordXml).toContain('w:jc w:val="center"');
  expect(await word.file('word/footer1.xml').async('string')).toContain('PAGE');
  await fs.copyFile(path.join(data, 'export.docx'), path.join(output, 'export.docx'));

  // Unsaved text is written before the window closes.
  await page.locator('.cm-content .cm-line').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Last words.');
  const exited = new Promise(resolve => app.process().once('exit', resolve));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
  expect(await read('First note.md')).toContain('Last words.');

  // The last note opens again on restart.
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('First note');
  await expect(page.locator('.cm-content')).toContainText('Last words.');
  expect(errors).toEqual([]);
  console.log('PASS: vault, live preview, tasks, wikilinks, backlinks, outline, history, reading view, format, toolbar, highlight, selection toolbar, rename, search, quick switcher, command palette, watcher, PDF and Word export, close and reopen.');
} catch (error) {
  try { const page = await app?.firstWindow(); await page?.screenshot({ path: path.join(output, 'failure.png') }); console.error(await page?.locator('body').innerText()); } catch { /* the app may have exited */ }
  throw error;
} finally {
  if (app) await app.close();
  await fs.rm(data, { recursive: true, force: true });
}
