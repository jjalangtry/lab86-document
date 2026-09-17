const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');

// Watches a folder tree. On macOS and Windows one recursive watcher covers the tree.
// On Linux Node's recursive watcher misses changes inside folders that appear after the
// start, so each folder gets its own watcher there.
class TreeWatcher {
  constructor(root, onChange, { delay = 300, ignore = name => name.startsWith('.') || name === 'node_modules', recursive = process.platform !== 'linux', maxBatch = 500 } = {}) {
    this.root = path.resolve(root);
    this.onChange = onChange;
    this.delay = delay;
    this.ignore = ignore;
    this.maxBatch = maxBatch;
    this.watchers = new Map();
    this.pending = new Set();
    this.timer = null;
    this.closed = false;
    this.recursive = recursive;
    this.ready = recursive ? this.addRecursive() : this.add(this.root);
  }

  async addRecursive() {
    try {
      const watcher = watch(this.root, { recursive: true }, (event, name) => { if (name) this.handle(this.root, event, String(name)); });
      watcher.on('error', () => { this.recursive = false; this.watchers.clear(); void this.add(this.root); });
      this.watchers.set(this.root, watcher);
    } catch { this.recursive = false; await this.add(this.root); }
  }

  async add(directory) {
    if (this.closed || this.watchers.has(directory)) return;
    let watcher;
    try {
      watcher = watch(directory, (event, name) => { if (name) this.handle(directory, event, String(name)); });
    } catch { return; }
    watcher.on('error', () => this.remove(directory));
    this.watchers.set(directory, watcher);
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory() && !this.ignore(entry.name)) await this.add(path.join(directory, entry.name));
    }
  }

  remove(directory) {
    for (const [key, watcher] of this.watchers) {
      if (key === directory || key.startsWith(directory + path.sep)) { watcher.close(); this.watchers.delete(key); }
    }
  }

  handle(directory, event, name) {
    const full = path.join(directory, name);
    const relative = path.relative(this.root, full).split(path.sep).join('/');
    if (relative.split('/').some(part => this.ignore(part)) || /\.tmp$/.test(relative)) return;
    // A very large batch is reported as one full refresh instead of thousands of paths.
    if (this.pending.size < this.maxBatch) this.pending.add(relative); else this.pending.add('*');
    if (event === 'rename' && !this.recursive) {
      fs.stat(full).then(info => { if (info.isDirectory()) return this.add(full); }).catch(() => this.remove(full));
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const changed = this.pending.has('*') ? ['*'] : [...this.pending];
      this.pending = new Set();
      if (!this.closed && changed.length) this.onChange(changed);
    }, this.delay);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}

module.exports = { TreeWatcher };
