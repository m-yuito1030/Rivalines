import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The game version comes only from package.json (shown on screen, checked against the server, and used for tags)
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: 'es2022' },
  server: { proxy: { '/api': 'http://localhost:8091', '/ws': { target: 'ws://localhost:8091', ws: true } } },
  worker: { format: 'es' },
  test: { testTimeout: 30000 },
});
