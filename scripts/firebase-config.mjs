import { createHash, createPrivateKey, ECDH, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'dotenv';

export const FIREBASE_SERVER_KEYS = Object.freeze([
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
]);
export const FIREBASE_WEB_KEYS = Object.freeze([
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_VAPID_KEY',
]);
export const defaultFirebaseDirectory = fileURLToPath(
  new URL('../.local/firebase', import.meta.url),
);
const generatedNames = ['server.env', 'web.env', 'manifest.json'];

export class FirebaseConfigurationError extends Error {
  constructor(field) {
    super('Invalid Firebase configuration: ' + field + '.');
    this.name = 'FirebaseConfigurationError';
  }
}
const invalid = (field) => new FirebaseConfigurationError(field);
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(field);
  return value;
}
function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(field);
  return value.trim();
}
function project(value, field) {
  const result = text(value, field);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(result)) throw invalid(field);
  return result;
}

/** Local structural/cryptographic validation only. This never contacts Firebase. */
export function validateFirebaseConfiguration(serviceAccount, webConfig) {
  const account = object(serviceAccount, 'service-account');
  const web = object(webConfig, 'web-config');
  if (account.type !== 'service_account') throw invalid('service-account.type');
  const projectId = project(account.project_id, 'service-account.project_id');
  if (project(web.projectId, 'web-config.projectId') !== projectId)
    throw invalid('projectId mismatch');
  if (
    ['private_key', 'privateKey', 'client_email', 'clientEmail', 'serviceAccount'].some(
      (key) => key in web,
    )
  )
    throw invalid('web-config contains server credentials');
  const clientEmail = text(account.client_email, 'service-account.client_email');
  if (
    !/^[a-zA-Z0-9._-]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail) ||
    !clientEmail.endsWith('@' + projectId + '.iam.gserviceaccount.com')
  )
    throw invalid('service-account.client_email');
  const privateKey = text(account.private_key, 'service-account.private_key')
    .replace(/\\n/g, '\n')
    .trim();
  try {
    if (
      !privateKey.startsWith('-----BEGIN PRIVATE KEY-----') ||
      !privateKey.endsWith('-----END PRIVATE KEY-----')
    )
      throw new Error();
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048)
      throw new Error();
  } catch {
    throw invalid('service-account.private_key');
  }
  const apiKey = text(web.apiKey, 'web-config.apiKey');
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(apiKey)) throw invalid('web-config.apiKey');
  const sender = text(web.messagingSenderId, 'web-config.messagingSenderId');
  if (!/^[0-9]{3,20}$/.test(sender)) throw invalid('web-config.messagingSenderId');
  const appId = text(web.appId, 'web-config.appId');
  if (!/^1:[0-9]+:web:[A-Za-z0-9_-]+$/.test(appId) || appId.split(':')[1] !== sender)
    throw invalid('web-config.appId');
  let vapidKey = text(web.vapidKey, 'web-config.vapidKey');
  try {
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(vapidKey)) throw new Error();
    vapidKey = vapidKey.replace(/=+$/, '');
    const bytes = Buffer.from(vapidKey, 'base64url');
    if (bytes.length !== 65 || bytes[0] !== 4 || bytes.toString('base64url') !== vapidKey)
      throw new Error();
    ECDH.convertKey(bytes, 'prime256v1', undefined, undefined, 'uncompressed');
  } catch {
    throw invalid('web-config.vapidKey');
  }
  return {
    projectId,
    server: {
      FIREBASE_PROJECT_ID: projectId,
      FIREBASE_CLIENT_EMAIL: clientEmail,
      FIREBASE_PRIVATE_KEY: privateKey,
    },
    web: {
      VITE_FIREBASE_API_KEY: apiKey,
      VITE_FIREBASE_PROJECT_ID: projectId,
      VITE_FIREBASE_MESSAGING_SENDER_ID: sender,
      VITE_FIREBASE_APP_ID: appId,
      VITE_FIREBASE_VAPID_KEY: vapidKey,
    },
  };
}

/** Import exactly the two generated allowlists; unrelated env values are refused. */
export function validateFirebaseEnvironment(serverValues, webValues) {
  const server = object(serverValues, 'server.env');
  const web = object(webValues, 'web.env');
  for (const [values, allowed, field] of [
    [server, FIREBASE_SERVER_KEYS, 'server.env'],
    [web, FIREBASE_WEB_KEYS, 'web.env'],
  ])
    if (
      Object.keys(values).length !== allowed.length ||
      Object.keys(values).some((key) => !allowed.includes(key))
    )
      throw invalid(field);
  return validateFirebaseConfiguration(
    {
      type: 'service_account',
      project_id: server.FIREBASE_PROJECT_ID,
      client_email: server.FIREBASE_CLIENT_EMAIL,
      private_key: server.FIREBASE_PRIVATE_KEY,
    },
    {
      apiKey: web.VITE_FIREBASE_API_KEY,
      projectId: web.VITE_FIREBASE_PROJECT_ID,
      messagingSenderId: web.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: web.VITE_FIREBASE_APP_ID,
      vapidKey: web.VITE_FIREBASE_VAPID_KEY,
    },
  );
}
function configuration(value) {
  const current = object(value, 'configuration');
  const result = validateFirebaseEnvironment(current.server, current.web);
  if (current.projectId !== result.projectId) throw invalid('configuration.projectId');
  return result;
}
function envText(values, keys) {
  return keys.map((key) => key + '=' + JSON.stringify(values[key])).join('\n') + '\n';
}
const digest = (content) => createHash('sha256').update(content).digest('hex');
export function firebaseEnvironmentFiles(value) {
  const current = configuration(value);
  return {
    'server.env': envText(current.server, FIREBASE_SERVER_KEYS),
    'web.env': envText(current.web, FIREBASE_WEB_KEYS),
  };
}
async function exists(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function readGenerated(directory, checkLock = true) {
  try {
    if (checkLock && (await exists(directory + '.lock')))
      throw invalid('configuration update in progress');
    const folder = await lstat(directory);
    if (!folder.isDirectory() || folder.isSymbolicLink()) throw invalid('configuration directory');
    for (const name of generatedNames) {
      const entry = await lstat(path.join(directory, name));
      if (!entry.isFile() || entry.isSymbolicLink()) throw invalid('generated files');
    }
    const manifestText = await readFile(path.join(directory, 'manifest.json'), 'utf8');
    const [serverText, webText] = await Promise.all([
      readFile(path.join(directory, 'server.env'), 'utf8'),
      readFile(path.join(directory, 'web.env'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText);
    const result = validateFirebaseEnvironment(parse(serverText), parse(webText));
    const latest = await readFile(path.join(directory, 'manifest.json'), 'utf8');
    if (
      manifestText !== latest ||
      (checkLock && (await exists(directory + '.lock'))) ||
      manifest.version !== 1 ||
      manifest.projectId !== result.projectId ||
      !Number.isFinite(Date.parse(manifest.configuredAt)) ||
      manifest.serverSha256 !== digest(serverText) ||
      manifest.webSha256 !== digest(webText)
    )
      throw invalid('generated files integrity');
    return result;
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) throw error;
    throw invalid('generated files');
  }
}
export async function readFirebaseConfiguration(directory = defaultFirebaseDirectory) {
  return readGenerated(path.resolve(directory));
}

/** Stage a complete pair and publish it together. Previous generated data is kept on replacement. */
export async function writeFirebaseConfiguration(
  value,
  { directory = defaultFirebaseDirectory, replace = false } = {},
) {
  const current = configuration(value); // Validate before any filesystem write.
  const destination = path.resolve(directory);
  const parent = path.dirname(destination);
  if (destination === parent) throw invalid('output directory');
  const token = randomUUID();
  const staging = path.join(parent, '.' + path.basename(destination) + '-stage-' + token);
  const backup = path.join(parent, '.' + path.basename(destination) + '-backup-' + token);
  const lockPath = destination + '.lock';
  let lock;
  let movedPrevious = false;
  let staged = false;
  let published = false;
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    lock = await open(lockPath, 'wx', 0o600);
    const previous = await exists(destination);
    if (previous) {
      if (!replace) throw invalid('output already exists; use --replace');
      if (!previous.isDirectory() || previous.isSymbolicLink()) throw invalid('output directory');
      const names = await readdir(destination);
      if (
        names.length !== generatedNames.length ||
        names.some((name) => !generatedNames.includes(name))
      )
        throw invalid('output contains unrelated files');
      await readGenerated(destination, false);
    }
    await mkdir(staging, { mode: 0o700 });
    staged = true;
    const files = firebaseEnvironmentFiles(current);
    const manifest = {
      version: 1,
      projectId: current.projectId,
      configuredAt: new Date().toISOString(),
      serverSha256: digest(files['server.env']),
      webSha256: digest(files['web.env']),
    };
    files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
    for (const [name, content] of Object.entries(files))
      await writeFile(path.join(staging, name), content, { flag: 'wx', mode: 0o600 });
    if (previous) {
      await rename(destination, backup);
      movedPrevious = true;
    }
    try {
      await rename(staging, destination);
      published = true;
    } catch (error) {
      if (movedPrevious) await rename(backup, destination);
      movedPrevious = false;
      throw error;
    }
    return {
      directory: destination,
      projectId: current.projectId,
      ...(movedPrevious ? { backupDirectory: backup } : {}),
    };
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) throw error;
    if (error.code === 'EEXIST') throw invalid('configuration update in progress');
    throw invalid('output files');
  } finally {
    // Only this call's explicitly named staging files are removed; original input files are never touched.
    if (staged && !published) {
      for (const name of generatedNames)
        await unlink(path.join(staging, name)).catch(() => undefined);
      await rmdir(staging).catch(() => undefined);
    }
    if (lock) {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}
export async function readFirebaseInput(file, field) {
  try {
    const bytes = await readFile(file);
    if (bytes.length > 65536) throw new Error();
    return object(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), field);
  } catch {
    throw invalid(field);
  }
}
export async function configureFirebaseFromFiles({
  serviceAccountFile,
  webConfigFile,
  directory = defaultFirebaseDirectory,
  replace = false,
}) {
  const [serviceAccount, web] = await Promise.all([
    readFirebaseInput(serviceAccountFile, 'service-account JSON'),
    readFirebaseInput(webConfigFile, 'web-config JSON'),
  ]);
  return writeFirebaseConfiguration(validateFirebaseConfiguration(serviceAccount, web), {
    directory,
    replace,
  });
}
