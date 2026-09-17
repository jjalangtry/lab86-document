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
// App hotkeys use Cmd on macOS. Document start and end also differ there.
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const docStart = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
const docEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
const todayName = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
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
  const formatting = page.getByRole('toolbar', { name: 'Selection formatting' });
  await body.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await formatting.getByRole('button', { name: /^Underline/ }).click();
  await expect.poll(() => read('First note.md')).toContain('<u>Plain line</u>');
  await formatting.getByRole('button', { name: /^Align center/ }).click();
  await expect.poll(() => read('First note.md')).toContain('<p align="center"><u>Plain line</u></p>');
  await page.keyboard.press(docStart);
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
  await formatting.getByRole('button', { name: /^Highlight/ }).click();
  await expect.poll(() => read('First note.md')).toContain('# Heading one');
  await expect(page.getByRole('toolbar', { name: 'Selection formatting' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('toolbar', { name: 'Selection formatting' })).toBeHidden();

  // Indented text stays a paragraph in both views.
  await page.keyboard.press(docEnd);
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

  // Hovering a wikilink shows a preview card of the linked note.
  await page.getByRole('treeitem', { name: 'First note' }).click();
  await page.locator('.cm-wikilink').hover();
  await expect(page.locator('.cm-hover-preview-title')).toHaveText('Renamed note', { timeout: 5000 });
  await page.mouse.move(5, 300);

  // Tabs: Ctrl+T opens an empty tab, Ctrl+click opens a note in a new tab, Ctrl+W closes.
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.keyboard.press(`${mod}+t`);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByText('No note is open')).toBeVisible();
  await page.getByRole('treeitem', { name: 'Renamed note' }).click({ modifiers: [mod] });
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('tab', { selected: true })).toHaveText(/Renamed note/);
  await page.getByRole('tab', { name: /First note/ }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('First note');
  await page.keyboard.press(`${mod}+w`);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('tab', { name: /New tab/ }).getByRole('button', { name: /Close/ }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Renamed note');

  // The tags pane lists tags. The daily note command makes today's note.
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.locator('.tag-item')).toHaveText(/#topic/);

  // Outgoing links list the links of the open note. Bookmarks come from the context menu.
  await page.getByRole('treeitem', { name: 'First note' }).click();
  await page.getByRole('button', { name: 'Outgoing links', exact: true }).click();
  await expect(page.locator('.outgoing-link')).toHaveText(/Renamed note/);
  await page.getByRole('treeitem', { name: 'First note' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Bookmark', exact: true }).click();
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(page.locator('.bookmark-open')).toHaveText('First note');

  // Templates insert with filled tokens. Settings open with Ctrl+,.
  await fs.mkdir(path.join(vault, 'Templates'), { recursive: true });
  await fs.writeFile(path.join(vault, 'Templates', 'Meeting.md'), '## Meeting {{date}}\n- Attendees:\n');
  await expect.poll(async () => { await page.keyboard.press(`${mod}+p`); await page.getByRole('combobox', { name: 'Select a command…' }).fill('insert template'); await page.keyboard.press('Enter'); const found = await page.getByRole('option', { name: /Meeting/ }).isVisible().catch(() => false); if (!found) await page.keyboard.press('Escape'); return found; }, { timeout: 10000 }).toBe(true);
  await page.getByRole('option', { name: /Meeting/ }).click();
  await expect.poll(() => read('First note.md')).toContain(`## Meeting ${todayName}`);
  await page.keyboard.press(`${mod}+,`);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Readable line length' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('.note-body')).toHaveClass(/is-wide/);

  // The graph view opens in a tab. A canvas is a .canvas file with cards.
  await page.getByRole('button', { name: /Graph view/ }).click();
  await expect(page.getByRole('tab', { selected: true })).toHaveText(/Graph view/);
  await expect(page.getByTestId('graph-view')).toBeVisible();
  await expect(page.locator('.graph-count')).toContainText(/notes/);
  await page.keyboard.press(`${mod}+w`);
  await page.getByRole('button', { name: 'Create new canvas', exact: true }).click();
  await expect(page.getByTestId('canvas-view')).toBeVisible();
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await page.getByRole('textbox', { name: 'Card text' }).fill('A canvas card');
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-node-body')).toContainText('A canvas card');
  await expect.poll(() => read('Untitled.canvas')).toContain('"text": "A canvas card"');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /Untitled/ })).toBeVisible();

  // Draw mode loads tldraw. A stroke is saved into the same canvas file.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const board = page.getByTestId('tldraw-board');
  await expect(board.locator('.tl-container')).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('d');
  const box = await board.locator('.tl-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => read('Untitled.canvas'), { timeout: 15000 }).toContain('"tldraw"');
  await expect.poll(() => read('Untitled.canvas')).toContain('"nodes"');
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.locator('.canvas-node-body')).toContainText('A canvas card');

  // Workspace state lives inside the vault, so it travels with the folder.
  await expect.poll(() => read('.document/workspace.json'), { timeout: 10000 }).toContain('"tabs"');
  expect(JSON.parse(await read('.document/workspace.json')).bookmarks).toContain('First note.md');
  await page.keyboard.press(`${mod}+w`);
  await page.keyboard.press(`${mod}+d`);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(todayName);
  await expect.poll(() => fs.readdir(path.join(vault, 'Daily'))).toContain(`${todayName}.md`);
  await page.getByRole('button', { name: 'Files', exact: true }).click();

  // Search finds text across notes and opens the match.
  await page.keyboard.press(`${mod}+Shift+F`);
  const search = page.getByRole('textbox', { name: 'Search all notes' });
  await expect(search).toBeFocused();
  await search.fill('a task');
  await expect(page.locator('.search-match')).toHaveCount(1);
  await page.locator('.search-match').click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('First note');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('a task');

  // Quick switcher opens by name and creates by name.
  await page.keyboard.press(`${mod}+o`);
  const switcher = page.getByRole('combobox', { name: 'Find or create a note…' });
  await expect(switcher).toBeFocused();
  await switcher.fill('renamed');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Renamed note');
  await page.keyboard.press(`${mod}+o`);
  await page.getByRole('combobox', { name: 'Find or create a note…' }).fill('Ideas/Third');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Third');
  await expect.poll(() => fs.readdir(path.join(vault, 'Ideas'))).toContain('Third.md');

  // Command palette runs a command.
  await page.keyboard.press(`${mod}+p`);
  await page.getByRole('combobox', { name: 'Select a command…' }).fill('source mode');
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').click();
  await page.keyboard.type('**raw**');
  await expect(page.locator('.cm-content')).toContainText('**raw**');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```js\nconst a = 1;\n```\n---\n> quoted');
  await expect.poll(() => read('Ideas/Third.md')).toContain('```js\nconst a = 1;\n```');
  await page.keyboard.press(`${mod}+p`);
  await page.getByRole('combobox', { name: 'Select a command…' }).fill('live preview');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-line.cm-codeblock')).toHaveCount(3);
  await expect(page.locator('.cm-line.cm-quote')).toHaveCount(1);
  await expect(page.locator('hr.cm-hr')).toHaveCount(1);

  // External changes on disk appear in the editor. The app's own save must finish first.
  await expect.poll(() => read('Ideas/Third.md')).toContain('> quoted');
  await fs.writeFile(path.join(vault, 'Ideas', 'Third.md'), 'Changed outside the app.\n\n> [!tip] Remember\n> Water twice.\n');
  await expect(page.locator('.cm-content')).toContainText('Changed outside the app.', { timeout: 10000 });

  // Callouts render in the live preview and the reading view.
  await page.locator('.cm-content .cm-line').first().click();
  await expect(page.locator('.cm-line.cm-callout-title')).toHaveText('Remember');
  await expect(page.locator('.cm-line.cm-callout').nth(1)).toHaveText('Water twice.');
  await page.getByTestId('mode-toggle').click();
  await expect(page.locator('.callout.callout-tip .callout-title')).toHaveText('Remember');
  await page.getByTestId('mode-toggle').click();

  // PDF export.
  await page.keyboard.press(`${mod}+o`);
  await page.getByRole('combobox', { name: 'Find or create a note…' }).fill('First');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('First note');
  await app.evaluate(({ dialog }, directory) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${directory}/export.pdf` }); }, data);
  await page.keyboard.press(`${mod}+Shift+E`);
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
  await page.keyboard.press(`${mod}+p`);
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

  // The workspace file records the active tab before the window closes.
  await expect.poll(async () => { const w = JSON.parse(await read('.document/workspace.json')); return w.tabs?.paths?.[w.tabs.active]; }, { timeout: 5000 }).toBe('First note.md');

  // Unsaved text is written before the window closes.
  await page.locator('.cm-content .cm-line').last().click();
  await page.keyboard.press(docEnd);
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
  console.log('PASS: vault, workspace file, draw mode, live preview, tasks, wikilinks, backlinks, outline, history, reading view, format, selection toolbar, highlight, hover preview, tabs, tags, daily note, callouts, rename, search, quick switcher, command palette, watcher, PDF and Word export, close and reopen.');
} catch (error) {
  try { const page = await app?.firstWindow(); await page?.screenshot({ path: path.join(output, 'failure.png') }); console.error(await page?.locator('body').innerText()); } catch { /* the app may have exited */ }
  throw error;
} finally {
  if (app) await app.close();
  await fs.rm(data, { recursive: true, force: true });
}
