import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
export const root = fileURLToPath(new URL('..', import.meta.url));
export const browserPath = path.join(root, '.local/playwright-browsers');
const readEnv = async (name) =>
  dotenv.parse(await readFile(path.join(root, name), 'utf8').catch(() => ''));
const identity = (value) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const host = ['localhost', '::1', '[::1]'].includes(hostname) ? '127.0.0.1' : hostname;
    return `${host.toLowerCase()}:${url.port || '5432'}${decodeURIComponent(url.pathname)}`;
  } catch {
    // URL parser errors may include credentials; report only the configuration category.
    throw new Error('Invalid application or integration database configuration.');
  }
};
export function validateE2EDatabase(value, forbidden = []) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Set DATABASE_E2E_URL in .local/e2e-db.env.');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    url.protocol !== 'postgresql:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !/^[a-z][a-z0-9_]{0,62}$/i.test(name) ||
    !/(?:^|_)e2e(?:_|$)/i.test(name)
  )
    throw new Error('E2E requires a dedicated loopback PostgreSQL database with e2e in its name.');
  if (forbidden.filter(Boolean).some((other) => identity(other) === identity(value)))
    throw new Error('E2E database must differ from both application and integration databases.');
  url.searchParams.set('connection_limit', '4');
  return url.toString();
}
export async function loadE2EEnvironment() {
  const [local, app, integration] = await Promise.all([
    readEnv('.local/e2e-db.env'),
    readEnv('.env'),
    readEnv('.local/test-db.env'),
  ]);
  const value = process.env.DATABASE_E2E_URL || local.DATABASE_E2E_URL;
  return validateE2EDatabase(value, [
    process.env.DATABASE_URL,
    app.DATABASE_URL,
    process.env.DATABASE_TEST_URL,
    integration.DATABASE_TEST_URL,
  ]);
}
export const isolatedWebEnvironment = {
  NODE_ENV: 'production',
  VITE_API_URL: '/api/v1',
  VITE_FIREBASE_API_KEY: '',
  VITE_FIREBASE_PROJECT_ID: '',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '',
  VITE_FIREBASE_APP_ID: '',
  VITE_FIREBASE_VAPID_KEY: '',
};
