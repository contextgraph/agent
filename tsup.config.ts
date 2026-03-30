import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  minify: false,
  sourcemap: true,
  dts: true,
  banner: {
    js: '#!/usr/bin/env node'
  }
});
