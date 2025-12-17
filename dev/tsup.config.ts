import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'codex-subagent': 'src/bin/codex-subagent.ts' },
  format: ['esm'],
  sourcemap: true,
  clean: false,
  target: 'node20',
  outDir: '..',
  splitting: false,
  shims: false,
  banner: { js: '#!/usr/bin/env node' },
});
