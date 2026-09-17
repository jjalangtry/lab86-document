import { build } from 'vite';
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const fixture = await fs.mkdtemp(path.join(process.cwd(), '.tab-fixture-'));
let app;
try {
  const entry = path.join(fixture, 'entry.js');
  const result = await build({
    configFile: false, logLevel: 'error',
    plugins: [{
      name: 'tab-fixture',
      resolveId(id) { if (id === entry) return entry; },
      load(id) {
        if (id !== entry) return;
        return `
          import { createEditor } from ${JSON.stringify(path.join(process.cwd(), 'src/editor.ts'))};
          window.note = createEditor(document.querySelector('#editor'), () => ({
            resolve: () => null, noteNames: () => [], openLink() {}, openExternal() {}, openTag() {},
            saveImage: async () => null, onChange(text) { window.savedText = text; }, openFormat() {}, mountToolbar() { return () => {}; }, preview: () => null
          }), 'live');
        `;
      },
    }],
    build: { write: false, minify: false, lib: { entry, name: 'TabFixture', formats: ['iife'] } },
  });
  await fs.writeFile(path.join(fixture, 'main.cjs'), `
    const {app, BrowserWindow} = require('electron');
    app.whenReady().then(() => {
      const win = new BrowserWindow({show: true});
      win.loadURL('data:text/html,<div id="editor"></div><button id="next">Next</button>');
    });
  `);
  app = await electron.launch({ args: [path.join(fixture, 'main.cjs'), '--no-sandbox', '--disable-gpu'] });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate((Array.isArray(result) ? result[0] : result).output[0].code);
  const content = page.locator('.cm-content');
  for (const mode of ['live', 'source']) {
    await page.evaluate(mode => {
      window.note.open(`${mode}.md`, 'First\nSecond');
      window.note.setMode(mode);
      window.note.view.focus();
    }, mode);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => window.note.text())).toBe('\tFirst\nSecond');
    expect(await page.evaluate(() => window.savedText)).toBe('\tFirst\nSecond');
    await expect(content).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => window.note.text())).toBe('First\nSecond');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => window.note.text())).toBe('\tFirst\n\tSecond');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    expect(await page.evaluate(() => window.note.text())).toBe('First\nSecond');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(page.locator('#next')).toBeFocused();
  }
  expect(errors).toEqual([]);
  console.log('Passed Tab, Shift+Tab, selection, undo, change notification, and focus checks in live and source modes.');
} finally {
  if (app) await app.close();
  await fs.rm(fixture, { recursive: true, force: true });
}
