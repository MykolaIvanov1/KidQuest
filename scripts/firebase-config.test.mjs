import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'dotenv';
import {
  FIREBASE_SERVER_KEYS,
  FIREBASE_WEB_KEYS,
  FirebaseConfigurationError,
  configureFirebaseFromFiles,
  firebaseEnvironmentFiles,
  readFirebaseConfiguration,
  readFirebaseInput,
  validateFirebaseConfiguration,
  validateFirebaseEnvironment,
  writeFirebaseConfiguration,
} from './firebase-config.mjs';

// Generated synthetic credentials are used only in these local tests, never in running services.
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const vapidKey = ecdh.getPublicKey().toString('base64url');
const projectId = 'kidquest-tooling-test';
function inputs() {
  return {
    account: {
      type: 'service_account',
      project_id: projectId,
      client_email: 'firebase-adminsdk-test@' + projectId + '.iam.gserviceaccount.com',
      private_key: privateKey,
    },
    web: {
      apiKey: 'AIza' + 'a'.repeat(35),
      projectId,
      messagingSenderId: '123456789012',
      appId: '1:123456789012:web:abcdef123456',
      vapidKey,
    },
  };
}
function valid() {
  const { account, web } = inputs();
  return validateFirebaseConfiguration(account, web);
}
const fixtureParent = fileURLToPath(new URL('../.local/firebase-tooling-tests/', import.meta.url));
async function fixture(t) {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(path.join(fixtureParent, 'case-'));
  t.after(async () => {
    const target = path.resolve(directory);
    // Recursive removal is limited to this test's explicitly created workspace fixture.
    assert.equal(path.dirname(target), path.resolve(fixtureParent));
    assert.match(path.basename(target), /^case-/);
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}
function invalidWithoutLeak(action, sensitive = []) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof FirebaseConfigurationError);
    assert.match(error.message, /^Invalid Firebase configuration:/);
    for (const value of sensitive) assert.ok(!error.message.includes(value));
    return true;
  });
}

test('Firebase configuration exports exactly the public and private allowlists', () => {
  const { account, web } = inputs();
  account.unrelated = 'input-only-private-value';
  web.authDomain = projectId + '.firebaseapp.com';
  const current = validateFirebaseConfiguration(account, web);
  assert.equal(current.projectId, projectId);
  assert.deepEqual(Object.keys(current.server), [...FIREBASE_SERVER_KEYS]);
  assert.deepEqual(Object.keys(current.web), [...FIREBASE_WEB_KEYS]);
  assert.equal(current.server.FIREBASE_PRIVATE_KEY, privateKey.trim());
  assert.equal(current.web.VITE_FIREBASE_VAPID_KEY, vapidKey);
  assert.equal(account.unrelated, 'input-only-private-value');
  assert.ok(!JSON.stringify(current).includes('input-only-private-value'));
});

test('Firebase validates matching projects, sender IDs, API key and service identity', () => {
  const mutations = [
    ({ account }) => {
      account.type = 'authorized_user';
    },
    ({ account }) => {
      account.project_id = 'bad';
    },
    ({ web }) => {
      web.projectId = 'another-project';
    },
    ({ account }) => {
      account.client_email = 'other@another-project.iam.gserviceaccount.com';
    },
    ({ web }) => {
      web.messagingSenderId = 'sender';
    },
    ({ web }) => {
      web.appId = '1:123:web:abcdef';
    },
    ({ web }) => {
      web.apiKey = 'private-invalid-api-key-value';
    },
    ({ web }) => {
      web.private_key = privateKey;
    },
    ({ web }) => {
      web.serviceAccount = { private_key: privateKey };
    },
  ];
  for (const mutate of mutations) {
    const candidate = inputs();
    mutate(candidate);
    invalidWithoutLeak(
      () => validateFirebaseConfiguration(candidate.account, candidate.web),
      [privateKey, 'private-invalid-api-key-value', 'another-project'],
    );
  }
});

test('Firebase private key must be a complete RSA PKCS8 key of at least 2048 bits', () => {
  const smallRsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  const ecKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  for (const value of ['private-invalid-key-value', privateKey.slice(0, 200), smallRsa, ecKey]) {
    const { account, web } = inputs();
    account.private_key = value;
    invalidWithoutLeak(() => validateFirebaseConfiguration(account, web), [value]);
  }
  const { account, web } = inputs();
  account.private_key = privateKey.replace(/\n/g, '\\n');
  assert.equal(
    validateFirebaseConfiguration(account, web).server.FIREBASE_PRIVATE_KEY,
    privateKey.trim(),
  );
});

test('Firebase VAPID must be a canonical uncompressed point on P256', () => {
  for (const value of [
    'private-invalid-vapid-value!',
    Buffer.alloc(65, 4).toString('base64url'),
    Buffer.alloc(32).toString('base64url'),
    vapidKey + 'a',
    ' ' + vapidKey.slice(1),
  ]) {
    const { account, web } = inputs();
    web.vapidKey = value;
    invalidWithoutLeak(() => validateFirebaseConfiguration(account, web), [value]);
  }
  const { account, web } = inputs();
  web.vapidKey += '=';
  assert.equal(validateFirebaseConfiguration(account, web).web.VITE_FIREBASE_VAPID_KEY, vapidKey);
});

test('Firebase environment refuses missing fields and unrelated runtime or private build settings', () => {
  const current = valid();
  assert.deepEqual(validateFirebaseEnvironment(current.server, current.web), current);
  for (const side of ['server', 'web']) {
    const extra = structuredClone(current);
    extra[side].JWT_SECRET = 'private-extra-setting';
    invalidWithoutLeak(
      () => validateFirebaseEnvironment(extra.server, extra.web),
      ['private-extra-setting'],
    );
    const missing = structuredClone(current);
    delete missing[side][Object.keys(missing[side])[0]];
    invalidWithoutLeak(() => validateFirebaseEnvironment(missing.server, missing.web));
  }
  const mismatch = structuredClone(current);
  mismatch.web.VITE_FIREBASE_PROJECT_ID = 'another-project';
  invalidWithoutLeak(
    () => validateFirebaseEnvironment(mismatch.server, mismatch.web),
    ['another-project'],
  );
});

test('Firebase env serialization roundtrips multiline PEM and keeps private values out of web file', () => {
  const current = valid();
  const files = firebaseEnvironmentFiles(current);
  assert.deepEqual(parse(files['server.env']), current.server);
  assert.deepEqual(parse(files['web.env']), current.web);
  assert.ok(!files['web.env'].includes(current.server.FIREBASE_CLIENT_EMAIL));
  assert.ok(!files['web.env'].includes('PRIVATE KEY'));
  assert.deepEqual(
    validateFirebaseEnvironment(parse(files['server.env']), parse(files['web.env'])),
    current,
  );
});

test('Firebase writes one validated pair and reads it with a secret-free integrity manifest', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'generated');
  const current = valid();
  const result = await writeFirebaseConfiguration(current, { directory });
  assert.equal(result.projectId, projectId);
  assert.deepEqual((await readdir(directory)).sort(), ['manifest.json', 'server.env', 'web.env']);
  assert.deepEqual(await readFirebaseConfiguration(directory), current);
  const manifestText = await readFile(path.join(directory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.projectId, projectId);
  assert.match(manifest.serverSha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.webSha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isFinite(Date.parse(manifest.configuredAt)));
  assert.ok(!manifestText.includes('PRIVATE KEY'));
  assert.ok(!manifestText.includes(current.web.VITE_FIREBASE_API_KEY));
  assert.ok(!manifestText.includes(current.server.FIREBASE_CLIENT_EMAIL));
});

test('Firebase refuses overwriting generated files without explicit replacement', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'generated');
  await writeFirebaseConfiguration(valid(), { directory });
  const before = await readFile(path.join(directory, 'manifest.json'), 'utf8');
  await assert.rejects(writeFirebaseConfiguration(valid(), { directory }), {
    message: /already exists/,
  });
  assert.equal(await readFile(path.join(directory, 'manifest.json'), 'utf8'), before);
  assert.deepEqual(await readFirebaseConfiguration(directory), valid());
  assert.deepEqual(await readdir(root), ['generated']);
});

test('Firebase replacement retains the prior complete configuration as a private backup', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'generated');
  const original = valid();
  await writeFirebaseConfiguration(original, { directory });
  const replacement = structuredClone(original);
  replacement.web.VITE_FIREBASE_API_KEY = 'AIza' + 'b'.repeat(35);
  const result = await writeFirebaseConfiguration(replacement, { directory, replace: true });
  assert.equal(path.dirname(result.backupDirectory), root);
  assert.deepEqual(await readFirebaseConfiguration(result.backupDirectory), original);
  assert.deepEqual(await readFirebaseConfiguration(directory), replacement);
  assert.equal((await readdir(root)).length, 2);
});

test('Firebase rejects invalid data before creating any output', async (t) => {
  const root = await fixture(t);
  const candidate = valid();
  candidate.projectId = 'another-project';
  await assert.rejects(
    writeFirebaseConfiguration(candidate, { directory: path.join(root, 'generated') }),
    FirebaseConfigurationError,
  );
  assert.deepEqual(await readdir(root), []);
});

test('Firebase lock blocks reads and competing writes while preserving the original lock and output', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'generated');
  await writeFirebaseConfiguration(valid(), { directory });
  await writeFile(directory + '.lock', 'test-owner');
  await assert.rejects(readFirebaseConfiguration(directory), { message: /update in progress/ });
  await assert.rejects(writeFirebaseConfiguration(valid(), { directory, replace: true }), {
    message: /update in progress/,
  });
  assert.equal(await readFile(directory + '.lock', 'utf8'), 'test-owner');
  assert.deepEqual(
    parse(await readFile(path.join(directory, 'server.env'), 'utf8')),
    valid().server,
  );
});

test('Firebase competing setup calls publish only one complete configuration', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'generated');
  const results = await Promise.allSettled([
    writeFirebaseConfiguration(valid(), { directory }),
    writeFirebaseConfiguration(valid(), { directory }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.deepEqual(await readFirebaseConfiguration(directory), valid());
  assert.deepEqual(await readdir(root), ['generated']);
});

test('Firebase replacement refuses unrelated files and leaves all existing data in place', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'generated');
  await writeFirebaseConfiguration(valid(), { directory });
  await writeFile(path.join(directory, 'family-data.txt'), 'keep');
  await assert.rejects(writeFirebaseConfiguration(valid(), { directory, replace: true }), {
    message: /unrelated files/,
  });
  assert.equal(await readFile(path.join(directory, 'family-data.txt'), 'utf8'), 'keep');
  assert.deepEqual(await readFirebaseConfiguration(directory), valid());
  assert.deepEqual(await readdir(root), ['generated']);
});

test('Firebase reader rejects modified generated contents or integrity metadata without exposing them', async (t) => {
  const root = await fixture(t);
  for (const [name, change] of [
    ['web.env', (value) => value.replace('AIza' + 'a'.repeat(35), 'AIza' + 'b'.repeat(35))],
    ['server.env', (value) => value + 'PRIVATE_OTHER=private-canary\n'],
    ['manifest.json', (value) => value.replace(projectId, 'another-project')],
  ]) {
    const directory = path.join(root, name.replace('.', '-'));
    await writeFirebaseConfiguration(valid(), { directory });
    const file = path.join(directory, name);
    await writeFile(file, change(await readFile(file, 'utf8')));
    await assert.rejects(readFirebaseConfiguration(directory), (error) => {
      assert.ok(error instanceof FirebaseConfigurationError);
      assert.ok(!error.message.includes('private-canary'));
      assert.ok(!error.message.includes('another-project'));
      return true;
    });
  }
});

test('Firebase refuses a symlinked output directory rather than moving its target', async (t) => {
  const root = await fixture(t);
  const target = path.join(root, 'target');
  const directory = path.join(root, 'generated');
  await writeFirebaseConfiguration(valid(), { directory: target });
  try {
    await symlink(target, directory, 'junction');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES')
      return t.skip('Symlink creation unavailable');
    throw error;
  }
  await assert.rejects(
    writeFirebaseConfiguration(valid(), { directory, replace: true }),
    FirebaseConfigurationError,
  );
  await assert.rejects(readFirebaseConfiguration(directory), FirebaseConfigurationError);
  assert.deepEqual(await readFirebaseConfiguration(target), valid());
});

test('Firebase file import accepts UTF8 BOM, preserves inputs and redacts invalid JSON or paths', async (t) => {
  const root = await fixture(t);
  const { account, web } = inputs();
  const accountFile = path.join(root, 'service-account.json');
  const webFile = path.join(root, 'web-config.json');
  const accountText = '\uFEFF' + JSON.stringify(account);
  const webText = JSON.stringify(web);
  await writeFile(accountFile, accountText);
  await writeFile(webFile, webText);
  const directory = path.join(root, 'generated');
  await configureFirebaseFromFiles({
    serviceAccountFile: accountFile,
    webConfigFile: webFile,
    directory,
  });
  assert.deepEqual(await readFirebaseConfiguration(directory), valid());
  assert.equal(await readFile(accountFile, 'utf8'), accountText);
  assert.equal(await readFile(webFile, 'utf8'), webText);
  for (const content of ['{"private-canary":', 'x'.repeat(65537)]) {
    await writeFile(webFile, content);
    await assert.rejects(readFirebaseInput(webFile, 'web-config JSON'), {
      message: 'Invalid Firebase configuration: web-config JSON.',
    });
  }
  await assert.rejects(
    readFirebaseInput(path.join(root, 'private-canary-missing.json'), 'service-account JSON'),
    { message: 'Invalid Firebase configuration: service-account JSON.' },
  );
});
