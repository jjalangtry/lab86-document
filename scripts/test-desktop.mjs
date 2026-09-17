// Runs the desktop tests. Linux needs a virtual display; Windows and macOS have one.
import { spawnSync } from 'node:child_process';
const tests = ['tests/desktop.mjs', 'tests/tab-indent.desktop.mjs'];
for (const test of tests) {
  const linux = process.platform === 'linux';
  // A hung test stops after 12 minutes instead of the runner's own limit.
  const result = spawnSync(linux ? 'xvfb-run' : process.execPath, linux ? ['-a', process.execPath, test] : [test], { stdio: 'inherit', timeout: 12 * 60 * 1000 });
  if (result.error) { console.error(`${test}: ${result.error.message}`); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
