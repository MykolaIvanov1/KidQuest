import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

function shellPrecache() {
  let assets: string[] = [];
  return {
    name: 'kidquest-shell-precache',
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      assets = Object.keys(bundle)
        .filter((name) => /\.(js|css)$/.test(name))
        .map((name) => `/${name}`);
    },
    async closeBundle() {
      if (!assets.length) return;
      const template = await readFile(new URL('./public/sw.js', import.meta.url), 'utf8');
      const version = assets
        .join('|')
        .split('')
        .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0);
      await writeFile(
        new URL('./dist/sw.js', import.meta.url),
        template
          .replace('/*__PRECACHE__*/ []', JSON.stringify(assets))
          .replace('kidquest-shell-v1', `kidquest-shell-${version}`),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), shellPrecache()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          forms: ['react-hook-form', '@hookform/resolvers/zod', 'zod'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  server: { port: 5173, strictPort: true, proxy: { '/api': process.env.KIDQUEST_API_PROXY || 'http://localhost:4000' } },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], css: false },
});
