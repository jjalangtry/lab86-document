import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
const bundle = path.resolve('release/mac-arm64/Document.app');
run(npm, ['run', 'build']);
run(npx, ['electron-builder', '--mac', '--dir', '--arm64']);
if (process.platform === 'darwin') {
  run('codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags', bundle]);
} else {
  // RCODESIGN selects a local executable. It does not contain credentials.
  const signer = process.env.RCODESIGN || 'rcodesign';
  try { run(signer, ['sign', '--config-file', process.platform === 'win32' ? 'NUL' : '/dev/null', '--timestamp-url', 'none', bundle]); }
  catch (error) {
    console.error('A cross-platform Mac build requires rcodesign. Set RCODESIGN to its executable path.');
    throw error;
  }
}
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const archive = path.resolve(`release/Document-${version}-mac-arm64.zip`);
rmSync(archive, { force: true });
rmSync(archive + '.blockmap', { force: true });
run(process.platform === 'win32' ? 'python' : 'python3', ['scripts/archive-mac.py', bundle, archive]);
