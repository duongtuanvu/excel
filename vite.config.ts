import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { 'duckdb-assets': fileURLToPath(new URL(mode === 'local-assets' ? './src/duckdb-assets.local.ts' : './src/duckdb-assets.cdn.ts', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  server: { host: '127.0.0.1' },
}));
