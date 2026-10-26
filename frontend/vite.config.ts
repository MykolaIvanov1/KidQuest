import { defineConfig } from 'vitest/config';
import { build, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

function shellPrecache(firebaseConfig: Record<string, string>): Plugin {
  let assets: string[] = [];
  let compiledPush: Promise<string> | undefined;
  function pushWorker() {
    compiledPush ??= build({
      configFile: false,
      publicDir: false,
      logLevel: 'warn',
      define: { __KIDQUEST_FIREBASE_CONFIG__: JSON.stringify(firebaseConfig) },
      build: {
        write: false,
        lib: {
          entry: fileURLToPath(new URL('./src/service-worker/push.js', import.meta.url)),
          formats: ['iife'],
          name: 'KidQuestPush',
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    })
      .then((worker) => {
        const output = Array.isArray(worker)
          ? worker.flatMap((item) => item.output)
          : 'output' in worker
            ? worker.output
            : [];
        return output
          .filter((item) => item.type === 'chunk')
          .map((item) => item.code)
          .join('\n');
      })
      .catch((error) => {
        compiledPush = undefined;
        throw error;
      });
    return compiledPush;
  }
  return {
    name: 'kidquest-shell-precache',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/sw.js') return next();
        // Push is opt-in in development too. Do not cache Vite's changing source shell.
        void pushWorker()
          .then((code) => {
            response.setHeader('Content-Type', 'application/javascript');
            response.setHeader('Cache-Control', 'no-store');
            response.end(code);
          })
          .catch(next);
      });
      server.watcher.on('change', (path) => {
        if (
          path.includes('/service-worker/') ||
          path.includes('\\service-worker\\') ||
          path.endsWith('paths.ts')
        )
          compiledPush = undefined;
      });
    },
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
      // Bundle Firebase into the same worker as the existing public shell cache.
      // No remote scripts or competing firebase-messaging-sw.js scope are needed.
      const pushCode = await pushWorker();
      await writeFile(
        new URL('./dist/sw.js', import.meta.url),
        template
          .replace('/*__PRECACHE__*/ []', JSON.stringify(assets))
          .replace('kidquest-shell-v1', `kidquest-shell-${version}`) +
          '\n' +
          pushCode,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), 'VITE_');
  return {
    plugins: [
      react(),
      shellPrecache({
        apiKey: env.VITE_FIREBASE_API_KEY || '',
        projectId: env.VITE_FIREBASE_PROJECT_ID || '',
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
        appId: env.VITE_FIREBASE_APP_ID || '',
      }),
    ],
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
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': process.env.KIDQUEST_API_PROXY || 'http://localhost:4000' },
    },
    test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], css: false },
  };
});
