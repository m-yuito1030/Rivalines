import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  server: { proxy: { '/api': 'http://localhost:8091', '/ws': { target: 'ws://localhost:8091', ws: true } } },
  worker: { format: 'es' },
  test: { testTimeout: 30000 },
});
