import { build } from 'esbuild';
import { writeFileSync, readFileSync, chmodSync } from 'fs';

const outfile = '../codex-subagent';

await build({
  entryPoints: ['src/bin/codex-subagent.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: outfile + '.tmp',
  sourcemap: true,
});

// Prepend shebang (esbuild's banner escapes the !)
const code = readFileSync(outfile + '.tmp', 'utf8');
writeFileSync(outfile, '#!/usr/bin/env node\n' + code);
writeFileSync(outfile + '.map', readFileSync(outfile + '.tmp.map'));
chmodSync(outfile, 0o755);

// Clean up temp files
import { unlinkSync } from 'fs';
unlinkSync(outfile + '.tmp');
unlinkSync(outfile + '.tmp.map');

console.log(`Built ${outfile}`);
