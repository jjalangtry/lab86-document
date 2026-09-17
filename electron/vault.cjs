const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_NOTE_BYTES = 20_000_000;
const MAX_ATTACHMENT_BYTES = 50_000_000;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const INVALID_NAME = /[\\/:*?"<>|#^[\]]/;
const IGNORED_FOLDERS = new Set(['node_modules', '.git', '.obsidian', '.trash']);

const toPosix = value => value.split(path.sep).join('/');
const isImage = name => IMAGE_EXTENSIONS.test(name);
const isNote = name => /\.md$/i.test(name);

function checkName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || INVALID_NAME.test(name) || name.startsWith('.')) {
    throw Error('The name contains characters that are not permitted.');
  }
  return name.trim();
}

class Vault {
  constructor(root) {
    this.root = path.resolve(root);
    this.name = path.basename(this.root);
    this.queues = new Map();
  }

  // Resolves a vault-relative path. Rejects paths that leave the vault.
  resolve(relative = '') {
    if (typeof relative !== 'string' || relative.length > 4000 || relative.includes('\0')) throw Error('Invalid path.');
    const full = path.resolve(this.root, relative.replace(/^[/\\]+/, ''));
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw Error('The path is outside the vault.');
    return full;
  }

  relative(full) { return toPosix(path.relative(this.root, full)); }

  async exists(relative) {
    try { await fs.access(this.resolve(relative)); return true; } catch { return false; }
  }

  // Returns folders and notes as a sorted tree. Hidden entries are skipped.
  async tree() {
    const walk = async directory => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const folders = [], files = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') || IGNORED_FOLDERS.has(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) folders.push({ name: entry.name, path: this.relative(full), kind: 'folder', children: await walk(full) });
        else if (entry.isFile() && (isNote(entry.name) || isImage(entry.name))) files.push({ name: entry.name, path: this.relative(full), kind: isNote(entry.name) ? 'note' : 'file' });
      }
      const stem = entry => (entry.kind === 'note' ? entry.name.replace(/\.md$/i, '') : entry.name);
      const byName = (a, b) => stem(a).localeCompare(stem(b), undefined, { numeric: true, sensitivity: 'base' });
      return [...folders.sort(byName), ...files.sort(byName)];
    };
    await fs.mkdir(this.root, { recursive: true });
    return walk(this.root);
  }

  // Reads every note. The renderer uses this for search, links, and backlinks.
  async index() {
    const notes = [];
    const walk = async entries => {
      for (const entry of entries) {
        if (entry.kind === 'folder') await walk(entry.children);
        else if (entry.kind === 'note') {
          try { notes.push({ path: entry.path, text: await this.read(entry.path) }); } catch { /* unreadable notes are skipped */ }
        }
      }
    };
    await walk(await this.tree());
    return notes;
  }

  async read(relative) {
    const full = this.resolve(relative);
    if (!isNote(full)) throw Error('Only Markdown notes can be opened.');
    const info = await fs.stat(full);
    if (info.size > MAX_NOTE_BYTES) throw Error('This note is too large to open.');
    return fs.readFile(full, 'utf8');
  }

  // Writes through a temporary file and an atomic rename. Writes to one note run in call order.
  async write(relative, text) {
    const full = this.resolve(relative);
    if (!isNote(full)) throw Error('Only Markdown notes can be saved.');
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_NOTE_BYTES) throw Error('This note is too large to save.');
    const previous = this.queues.get(full) || Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(full), { recursive: true });
      const temp = `${full}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temp, 'wx', 0o644);
        try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temp, full);
      } finally { await fs.rm(temp, { force: true }); }
    });
    this.queues.set(full, run);
    run.finally(() => { if (this.queues.get(full) === run) this.queues.delete(full); }).catch(() => {});
    return run;
  }

  async uniqueName(folder, base, extension) {
    const stem = checkName(base);
    for (let n = 0; n < 10000; n++) {
      const candidate = n === 0 ? `${stem}${extension}` : `${stem} ${n}${extension}`;
      const relative = folder ? `${folder}/${candidate}` : candidate;
      if (!(await this.exists(relative))) return relative;
    }
    throw Error('Could not find a free name.');
  }

  async createNote(folder = '', name = 'Untitled', text = '') {
    this.resolve(folder);
    const relative = await this.uniqueName(folder, name, '.md');
    await this.write(relative, text);
    return relative;
  }

  async createFolder(folder = '', name = 'New folder') {
    this.resolve(folder);
    const relative = await this.uniqueName(folder, name, '');
    await fs.mkdir(this.resolve(relative), { recursive: true });
    return relative;
  }

  async rename(from, to) {
    const source = this.resolve(from), target = this.resolve(to);
    if (source === this.root || target === this.root) throw Error('The vault folder cannot be renamed.');
    checkName(path.basename(target).replace(/\.md$/i, ''));
    if (isNote(source) !== isNote(target)) throw Error('A note must keep the .md extension.');
    if (source !== target && (await this.exists(to))) throw Error('An item with this name exists.');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
    return this.relative(target);
  }

  async saveAttachment(name, data) {
    const buffer = Buffer.from(data);
    if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) throw Error('The image is too large.');
    const extension = path.extname(name).toLowerCase();
    if (!isImage(extension)) throw Error('Only image files can be attached.');
    const relative = await this.uniqueName('attachments', path.basename(name, extension), extension);
    await fs.mkdir(this.resolve('attachments'), { recursive: true });
    await fs.writeFile(this.resolve(relative), buffer);
    return relative;
  }
}

module.exports = { Vault, checkName, isImage, isNote, toPosix };
