import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts', 'src/cli/cg.ts'],
  format: ['esm'],
  target: 'node18',
  shims: true,
  clean: true,
  minify: false,
  sourcemap: true,
  dts: true,
  banner: {
    js: '#!/usr/bin/env node'
  }
});
