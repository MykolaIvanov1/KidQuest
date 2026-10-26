import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { root, loadE2EEnvironment, isolatedWebEnvironment } from './e2e-environment.mjs';
import { runNode, viteCli } from './e2e-process.mjs';
import { createE2EFaultProxy } from './e2e-fault-proxy.mjs';
const database = await loadE2EEnvironment();
const mode = process.argv[2];
if (!['api', 'web'].includes(mode)) throw new Error('Use e2e-server.mjs api or web.');
if (mode === 'web') {
  const proxy = createE2EFaultProxy();
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(4101, '127.0.0.1', resolve);
  });
  try {
    process.exitCode = await runNode(
      viteCli,
      ['preview', '--host', '127.0.0.1', '--port', '5180', '--strictPort'],
      {
        cwd: path.join(root, 'frontend'),
        env: {
          ...process.env,
          ...isolatedWebEnvironment,
          KIDQUEST_API_PROXY: 'http://127.0.0.1:4101',
        },
      },
    );
  } finally {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
} else {
  const storage = path.join(root, '.local/e2e-storage');
  await mkdir(storage, { recursive: true });
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: database,
    PORT: '4100',
    TRUST_PROXY: '0',
    FRONTEND_URL: 'http://127.0.0.1:5180',
    JWT_SECRET: randomBytes(48).toString('hex'),
    STORAGE_PATH: storage,
    FIREBASE_PROJECT_ID: '',
    FIREBASE_CLIENT_EMAIL: '',
    FIREBASE_PRIVATE_KEY: '',
  };
  const migrated = await runNode(
    path.join(root, 'node_modules/prisma/build/index.js'),
    ['migrate', 'deploy'],
    { env, stdio: 'ignore' },
  );
  if (migrated)
    throw new Error('E2E migrations failed. Check the dedicated database configuration.');
  process.exitCode = await runNode(path.join(root, 'backend/dist/server.js'), [], { env });
}
