import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin/codex-subagent.ts', 'src/workers/start-runner.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'node20',
  outDir: 'dist',
  splitting: false,
  shims: false,
  banner: { js: '#!/usr/bin/env node' },
});
