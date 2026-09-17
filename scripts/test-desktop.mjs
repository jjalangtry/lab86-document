// Runs the desktop tests. Linux needs a virtual display; Windows and macOS have one.
import { spawnSync } from 'node:child_process';
const tests = ['tests/desktop.mjs', 'tests/tab-indent.desktop.mjs'];
for (const test of tests) {
  const linux = process.platform === 'linux';
  const result = spawnSync(linux ? 'xvfb-run' : process.execPath, linux ? ['-a', process.execPath, test] : [test], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
