import { spawnSync } from 'node:child_process';

function binaryExists(cmd) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

if (!binaryExists('prek')) {
  console.log('[prek] binary not found on PATH; skipping prek install hook.');
  process.exit(0);
}

const installResult = spawnSync('prek', ['install'], { stdio: 'inherit' });
process.exit(installResult.status ?? 0);
