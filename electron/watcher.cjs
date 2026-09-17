const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');

// Watches a folder tree with one non-recursive watcher per folder. Node's recursive
// watcher on Linux misses change events inside folders that appear after the start.
class TreeWatcher {
  constructor(root, onChange, { delay = 300, ignore = name => name.startsWith('.') || name === 'node_modules' } = {}) {
    this.root = path.resolve(root);
    this.onChange = onChange;
    this.delay = delay;
    this.ignore = ignore;
    this.watchers = new Map();
    this.pending = new Set();
    this.timer = null;
    this.closed = false;
    this.ready = this.add(this.root);
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
    if (this.ignore(name) || /\.tmp$/.test(name)) return;
    const full = path.join(directory, name);
    const relative = path.relative(this.root, full).split(path.sep).join('/');
    this.pending.add(relative);
    if (event === 'rename') {
      fs.stat(full).then(info => { if (info.isDirectory()) return this.add(full); }).catch(() => this.remove(full));
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const changed = [...this.pending];
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
