const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Packaged builds only include runtime dependencies. Every package the main process
// requires must be in "dependencies", or the app fails to start after packaging.
test('main-process modules require runtime dependencies only', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const runtime = new Set(Object.keys(pkg.dependencies || {}));
  const directory = path.join(__dirname, '../electron');
  const missing = [];
  for (const file of fs.readdirSync(directory)) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      const name = match[1];
      if (name.startsWith('.') || name.startsWith('node:') || name === 'electron') continue;
      const base = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (!runtime.has(base)) missing.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});
