import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'node:net';
import {
  validateFunnelTransport,
  validateFunnelOrigin,
  funnelOrigin,
  funnelOverride,
} from './pc-funnel-config.mjs';
import {
  readTailscaleTransport,
  checkFunnelOwnership,
  enableFunnel,
  verifyFunnel,
  disableFunnel,
} from './pc-funnel.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import {
  FIREBASE_SERVER_KEYS,
  FIREBASE_WEB_KEYS,
  readFirebaseConfiguration,
} from './firebase-config.mjs';
import {
  validateMobileProject,
  validateMobileOrigin,
  quickTunnelOrigin,
  mobileOverride,
  mobileProcessEnvironment,
  validateMobileComposeConfig,
  mobileFirebaseEnvironment,
  mobileApprovedFirebase,
  firebaseFingerprint,
} from './mobile-preview-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const folder = path.join(root, '.local/mobile-preview');
const stateFile = path.join(folder, 'state.json');
const envFile = path.join(folder, 'mobile.env');
const overrideFile = path.join(folder, 'override.yml');
const lockFile = path.join(folder, 'operation.lock');
const mode = process.argv[2];
if (!['start', 'resume', 'status', 'stop', 'firebase', 'funnel', 'backup'].includes(mode))
  throw new Error(
    'Use mobile:start, pc:start, mobile:status, mobile:stop, mobile:firebase, pc:address or pc:backup.',
  );

async function docker(args, label, privateOutput = false) {
  const childEnvironment = mobileProcessEnvironment(await readFile(envFile, 'utf8'));
  const child = spawn('docker', args, {
    cwd: root,
    env: childEnvironment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => {
    if (output.length < 2_000_000) output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    if (errors.length < 2_000_000) errors += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', () =>
      reject(new Error('Docker was not found or is unavailable. Start Docker Desktop.')),
    );
    child.once('close', resolve);
  });
  if (code !== 0) {
    if (privateOutput) throw new Error(label + ' failed. Private configuration was not logged.');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'last-error.log'), output + errors);
    throw new Error(label + ' failed. Details: .local/mobile-preview/last-error.log');
  }
  return privateOutput ? output : output + errors;
}
let state;
async function loadState() {
  state = await readFile(stateFile, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (state) {
    validateMobileProject(state.project);
    if (state.transport) validateFunnelTransport(state.transport);
    if (state.origin) currentOrigin(state.origin);
  }
}
const compose = (args, label, privateOutput = false) =>
  docker(
    [
      'compose',
      '-p',
      state.project,
      '--env-file',
      envFile,
      '-f',
      'docker-compose.prod.yml',
      '-f',
      overrideFile,
      ...args,
    ],
    label,
    privateOutput,
  );
function currentOrigin(value) {
  return state.transport
    ? validateFunnelOrigin(value, state.transport)
    : validateMobileOrigin(value);
}
async function checkConfiguration(approvedFirebase = null) {
  const model = await compose(['config', '--format', 'json'], 'Configuration validation', true);
  try {
    validateMobileComposeConfig(
      JSON.parse(model),
      await readFile(envFile, 'utf8'),
      state.project,
      approvedFirebase,
      state.transport || null,
    );
  } catch {
    throw new Error('Mobile preview configuration is not isolated. No public startup was allowed.');
  }
}
async function replaceFile(file, content) {
  const temporary = path.join(folder, '.' + path.basename(file) + '-' + randomUUID() + '.tmp');
  await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}
async function saveState() {
  await replaceFile(stateFile, JSON.stringify(state, null, 2));
}
async function approvedConfiguration() {
  if (!state.firebase) return null;
  const approved = mobileApprovedFirebase(await readFile(envFile, 'utf8'), state.firebase);
  const local = await readFirebaseConfiguration();
  if (firebaseFingerprint(local) !== firebaseFingerprint(approved))
    throw new Error('Firebase input changed. Run pnpm mobile:firebase to apply it explicitly.');
  return approved;
}
async function ready(origin) {
  try {
    const response = await fetch(origin + '/api/v1/ready', {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    return response.ok && (await response.json()).data?.status === 'ready';
  } catch {
    return false;
  }
}
async function waitUntilReady(origin) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await ready(origin)) return;
    await delay(1500);
  }
  throw new Error('Public HTTPS readiness failed. The link has not been confirmed.');
}
async function initialize() {
  if (state) return;
  await mkdir(folder, { recursive: true });
  state = {
    project: 'kidquest-mobile-' + randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    origin: null,
  };
  const password = randomBytes(32).toString('hex');
  const content = [
    'COMPOSE_PROJECT_NAME=' + state.project,
    'KIDQUEST_DOMAIN=mobile.invalid',
    'CADDY_EMAIL=mobile@example.test',
    'KIDQUEST_IMAGE_TAG=local',
    'POSTGRES_USER=kidquest_mobile',
    'POSTGRES_DB=kidquest_mobile',
    'POSTGRES_PASSWORD=' + password,
    'DATABASE_URL=postgresql://kidquest_mobile:' +
      password +
      '@db:5432/kidquest_mobile?schema=public&connection_limit=4',
    'JWT_SECRET=' + randomBytes(48).toString('hex'),
    'JWT_EXPIRATION=15m',
    'REFRESH_TOKEN_EXPIRATION=30d',
    ...[...FIREBASE_SERVER_KEYS, ...FIREBASE_WEB_KEYS].map((key) => key + '='),
    '',
  ].join('\n');
  await writeFile(envFile, content, { flag: 'wx', mode: 0o600 });
  await saveState();
}
async function showReadyLink(origin) {
  try {
    await QRCode.toFile(path.join(folder, 'qr.png'), origin, {
      width: 320,
      margin: 4,
      errorCorrectionLevel: 'M',
    });
  } catch {
    console.warn('QR code could not be saved. Open the HTTPS link directly.');
  }
  console.log('KidQuest mobile preview is ready: ' + origin);
}
let startedTunnel = false;
async function start({ build = true } = {}) {
  const firstRun = !state;
  await initialize();
  if (state.transport) return resumeFunnel();
  const firebase = await approvedConfiguration();
  if (state.origin && (await ready(currentOrigin(state.origin)))) {
    await checkConfiguration(firebase);
    await showReadyLink(state.origin);
    return;
  }
  const source = await readFile(path.join(root, 'docker/Caddyfile'), 'utf8');
  await writeFile(path.join(folder, 'Caddyfile'), source.replace('{$KIDQUEST_DOMAIN} {', ':80 {'));
  await writeFile(overrideFile, mobileOverride(folder));
  await checkConfiguration(firebase);
  if (build) {
    console.log('Building isolated mobile test images...');
    await compose(['build'], 'Image build', Boolean(firebase));
  }
  await checkConfiguration(firebase);
  console.log('Starting temporary HTTPS tunnel...');
  startedTunnel = true;
  await compose(
    ['up', '-d', '--no-deps', '--no-build', '--pull', build ? 'missing' : 'never', 'tunnel'],
    'Tunnel startup',
    Boolean(firebase),
  );
  const container = (await compose(['ps', '-q', 'tunnel'], 'Tunnel lookup', true)).trim();
  if (!/^[a-f0-9]{12,64}$/.test(container)) throw new Error('Tunnel container did not start.');
  const startedAt = (
    await docker(
      ['inspect', '--format', '{{.State.StartedAt}}', container],
      'Tunnel start time',
      true,
    )
  ).trim();
  if (!Number.isFinite(Date.parse(startedAt))) throw new Error('Tunnel start time unavailable.');
  let origin = null;
  for (let attempt = 0; attempt < 40 && !origin; attempt += 1) {
    origin = quickTunnelOrigin(
      await compose(
        ['logs', '--no-color', '--since', startedAt, '--tail', '100', 'tunnel'],
        'Tunnel address',
        true,
      ),
    );
    if (!origin) await delay(1500);
  }
  if (!origin)
    throw new Error('Cloudflare did not issue a temporary URL. Check the local tunnel logs.');
  const env = await readFile(envFile, 'utf8');
  await replaceFile(
    envFile,
    env.replace(/^KIDQUEST_DOMAIN=.*$/m, 'KIDQUEST_DOMAIN=' + new URL(origin).hostname),
  );
  state.origin = origin;
  state.startedAt = startedAt;
  await saveState();
  await checkConfiguration(firebase);
  console.log('Starting isolated database, API and web...');
  await compose(
    [
      'up',
      '-d',
      '--no-build',
      '--pull',
      build ? 'missing' : 'never',
      '--wait',
      '--wait-timeout',
      '120',
      'db',
      'migrate',
      'api',
      'web',
    ],
    'Application startup',
    Boolean(firebase),
  );
  console.log('Checking the public HTTPS endpoint...');
  await waitUntilReady(origin);
  state.verifiedAt = new Date().toISOString();
  await saveState();
  await showReadyLink(origin);
  console.log(
    firstRun
      ? 'Register a new family in this separate mobile database.'
      : 'Use your existing mobile family account. Its database and photos were preserved.',
  );
}
async function runningContainer(service) {
  const id = (await compose(['ps', '-q', service], 'Mobile container lookup', true)).trim();
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('The mobile preview must already be running.');
  return id;
}
async function imageId(reference, container = false) {
  const id = (
    await docker(
      [
        'inspect',
        '--type=' + (container ? 'container' : 'image'),
        '--format',
        container ? '{{.Image}}' : '{{.Id}}',
        reference,
      ],
      'Previous mobile image lookup',
      true,
    )
  ).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('Previous mobile image is unavailable.');
  return id;
}
const applyServices = [
  'up',
  '-d',
  '--no-deps',
  '--no-build',
  '--pull',
  'never',
  '--wait',
  '--wait-timeout',
  '120',
  'api',
  'web',
];
async function attachFirebase() {
  if (!state?.origin) throw new Error('Start the mobile preview before applying Firebase.');
  const origin = currentOrigin(state.origin);
  const previousEnvironment = await readFile(envFile, 'utf8');
  const previousState = structuredClone(state);
  const previousFirebase = mobileApprovedFirebase(previousEnvironment, state.firebase);
  await checkConfiguration(previousFirebase);
  if (!(await ready(origin)))
    throw new Error('The mobile preview must already be ready. Run pnpm mobile:start.');
  const next = await readFirebaseConfiguration();
  const tunnel = state.transport ? null : await runningContainer('tunnel');
  const apiImage = await imageId(await runningContainer('api'), true);
  const previousTag = mobileProcessEnvironment(previousEnvironment, {}).KIDQUEST_IMAGE_TAG;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(previousTag || ''))
    throw new Error('Invalid mobile image tag.');
  if (
    (await imageId('kidquest-api:' + previousTag)) !== apiImage ||
    (await imageId('kidquest-web:' + previousTag)) !==
      (await imageId(await runningContainer('web'), true))
  )
    throw new Error(
      'Previous mobile image tags do not match the running containers. No Firebase changes were applied.',
    );
  const migrateImage = await imageId('kidquest-migrate:' + previousTag);
  const tag = state.project + '-firebase-' + randomUUID().slice(0, 8);
  let changed = false;
  let containersChanged = false;
  try {
    const environment = mobileFirebaseEnvironment(previousEnvironment, next).replace(
      /^KIDQUEST_IMAGE_TAG=.*$/m,
      'KIDQUEST_IMAGE_TAG=' + tag,
    );
    await replaceFile(envFile, environment);
    changed = true;
    await checkConfiguration(next);
    // New image tags preserve the previous web build for rollback and leave shared local tags alone.
    await docker(['tag', apiImage, 'kidquest-api:' + tag], 'API image preservation', true);
    await docker(
      ['tag', migrateImage, 'kidquest-migrate:' + tag],
      'Migration image preservation',
      true,
    );
    console.log('Building web push configuration. The tunnel URL and family data are preserved...');
    await compose(['build', 'web'], 'Firebase web image build', true);
    await checkConfiguration(next);
    containersChanged = true;
    await compose(applyServices, 'Firebase API and web startup', true);
    if (tunnel && (await runningContainer('tunnel')) !== tunnel)
      throw new Error('The existing mobile tunnel changed unexpectedly.');
    await waitUntilReady(origin);
    state.firebase = {
      projectId: next.projectId,
      fingerprint: firebaseFingerprint(next),
      enabledAt: new Date().toISOString(),
    };
    state.verifiedAt = new Date().toISOString();
    await saveState();
    console.log('Firebase configuration attached to the existing mobile preview.');
    console.log('Open the installed PWA and enable notifications to test delivery on each phone.');
    await showReadyLink(origin);
  } catch {
    state = previousState;
    if (changed) {
      try {
        await replaceFile(envFile, previousEnvironment);
        await saveState();
        await checkConfiguration(previousFirebase);
        if (containersChanged) {
          await compose(applyServices, 'Previous mobile API and web restoration', true);
          await waitUntilReady(origin);
        }
      } catch {
        throw new Error(
          'Firebase setup failed and automatic API/web restoration failed. Mobile volumes and tunnel were preserved; inspect the local configuration before retrying.',
        );
      }
    }
    throw new Error(
      'Firebase setup failed. The previous configuration was restored; the mobile URL and family data were preserved. Private values were not logged.',
    );
  }
}

async function assertTailscaleIdentity(transport) {
  const identity = await readTailscaleTransport();
  validateFunnelTransport(transport, identity.hostname);
}
async function resumeFunnel() {
  const transport = validateFunnelTransport(state.transport);
  await assertTailscaleIdentity(transport);
  const firebase = await approvedConfiguration();
  await checkConfiguration(firebase);
  console.log('Restoring KidQuest from existing images. Database and photos are preserved...');
  await compose(
    [
      'up',
      '-d',
      '--no-build',
      '--pull',
      'never',
      '--wait',
      '--wait-timeout',
      '120',
      'db',
      'migrate',
      'api',
      'web',
    ],
    'PC application startup',
    true,
  );
  await enableFunnel(transport);
  await verifyFunnel(transport);
  await waitUntilReady(funnelOrigin(transport));
  state.verifiedAt = new Date().toISOString();
  await saveState();
  await showReadyLink(state.origin);
}
async function availableLoopback(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch {
    throw new Error('The KidQuest loopback port is occupied. No address changes were applied.');
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}
async function attachFunnel() {
  if (!state?.origin)
    throw new Error('Start the existing mobile preview before setting its permanent address.');
  const transport = await readTailscaleTransport();
  if (state.transport) {
    validateFunnelTransport(state.transport, transport.hostname);
    return resumeFunnel();
  }
  const firebase = await approvedConfiguration();
  await checkConfiguration(firebase);
  if (!(await ready(currentOrigin(state.origin))))
    throw new Error('The existing mobile preview must be ready before changing its address.');
  const previousState = structuredClone(state);
  const previousEnvironment = await readFile(envFile, 'utf8');
  const previousOverride = await readFile(overrideFile, 'utf8');
  const oldTunnel = await runningContainer('tunnel');
  const database = await runningContainer('db');
  const databasePolicy = (
    await docker(
      ['inspect', '--format', '{{.HostConfig.RestartPolicy.Name}}', database],
      'Database restart policy lookup',
      true,
    )
  ).trim();
  if (!['no', 'always', 'unless-stopped', 'on-failure'].includes(databasePolicy))
    throw new Error('Unknown database restart policy.');
  const alreadyOwned = await checkFunnelOwnership(transport);
  await availableLoopback(transport.port);
  let changed = false;
  let enabled = false;
  let databaseUpdated = false;
  const rollback = path.join(folder, 'pc-cutover-' + randomUUID());
  try {
    // Obtain Funnel permission first. Failure here leaves the working Quick Tunnel untouched.
    enabled = true;
    await enableFunnel(transport);
    await verifyFunnel(transport);
    await mkdir(rollback, { mode: 0o700 });
    await writeFile(path.join(rollback, 'mobile.env'), previousEnvironment, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(path.join(rollback, 'override.yml'), previousOverride, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(path.join(rollback, 'state.json'), JSON.stringify(previousState, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    changed = true;
    await replaceFile(
      envFile,
      previousEnvironment.replace(/^KIDQUEST_DOMAIN=.*$/m, 'KIDQUEST_DOMAIN=' + transport.hostname),
    );
    await replaceFile(overrideFile, funnelOverride(folder, transport));
    state.transport = transport;
    state.origin = funnelOrigin(transport);
    await checkConfiguration(firebase);
    console.log(
      'Applying the permanent PC address. Existing accounts, Firebase and files are retained...',
    );
    await compose(applyServices, 'Permanent address API and web startup', true);
    await waitUntilReady('http://127.0.0.1:' + transport.port);
    await verifyFunnel(transport);
    await waitUntilReady(state.origin);
    await docker(
      ['update', '--restart', 'unless-stopped', database],
      'Database automatic restart',
      true,
    );
    databaseUpdated = true;
    state.verifiedAt = new Date().toISOString();
    state.pcConfiguredAt = new Date().toISOString();
    await saveState();
  } catch {
    state = previousState;
    let restored = true;
    if (changed) {
      try {
        await replaceFile(envFile, previousEnvironment);
        await replaceFile(overrideFile, previousOverride);
        await saveState();
        await checkConfiguration(firebase);
        await compose(applyServices, 'Previous PC address restoration', true);
        if (databaseUpdated)
          await docker(
            ['update', '--restart', databasePolicy, database],
            'Previous restart policy restoration',
            true,
          );
        await waitUntilReady(previousState.origin);
      } catch {
        restored = false;
      }
    }
    if (enabled && !alreadyOwned) await disableFunnel(transport).catch(() => undefined);
    throw new Error(
      restored
        ? 'Permanent address setup failed. The existing address and family data were preserved. Check Tailscale sign-in and Funnel permission.'
        : 'Permanent address setup failed and automatic restoration needs attention. Volumes were preserved; do not reset the database.',
    );
  }
  // Cutover is complete; stop only the previous connector, never delete its container or volumes.
  await docker(['stop', oldTunnel], 'Previous temporary tunnel shutdown', true).catch(() =>
    console.warn(
      'The previous temporary connector could not be stopped. The permanent address is ready.',
    ),
  );
  await showReadyLink(state.origin);
  console.log(
    'Sign in with your existing accounts at this address, install the PWA once and enable push on each phone.',
  );
}
async function backupCurrentHost() {
  if (!state) throw new Error('No existing KidQuest host to back up.');
  const firebase = await approvedConfiguration();
  await checkConfiguration(firebase);
  // The operation lock also excludes logon recovery while application writes are paused.
  const wasRunning =
    (await compose(['ps', '-q', 'api'], 'Backup API state', true)).trim().length > 0;
  try {
    if (wasRunning) await compose(['stop', 'api'], 'Pause writes for backup', true);
    const child = spawn(
      process.execPath,
      [
        'scripts/backup.mjs',
        '--mode',
        'compose',
        '--env-file',
        envFile,
        '--compose-file',
        'docker-compose.prod.yml',
        '--writes-paused',
      ],
      {
        cwd: root,
        env: mobileProcessEnvironment(await readFile(envFile, 'utf8')),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.resume();
    child.stderr.resume();
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0) throw new Error('KidQuest backup failed. No private output was logged.');
    console.log('Database and photo backup verified in .local/backups.');
  } finally {
    if (wasRunning) await compose(['start', 'api'], 'Resume API after backup', true);
  }
}

let operationLock;
try {
  if (mode !== 'status') {
    await mkdir(folder, { recursive: true });
    try {
      operationLock = await open(lockFile, 'wx', 0o600);
    } catch {
      throw new Error(
        'Another mobile operation is active. If it was interrupted, inspect .local/mobile-preview/operation.lock before retrying.',
      );
    }
  }
  // Mutations read state only after taking the lock, so it cannot come from an earlier operation.
  await loadState();
  if (mode === 'start') await start();
  else if (mode === 'resume') {
    if (!state)
      throw new Error('Create the initial mobile deployment with pnpm mobile:start first.');
    await start({ build: false });
  } else if (mode === 'funnel') await attachFunnel();
  else if (mode === 'backup') await backupCurrentHost();
  else if (mode === 'firebase') await attachFirebase();
  else if (!state) console.log('No mobile preview has been created.');
  else if (mode === 'stop') {
    if (state.transport) {
      await assertTailscaleIdentity(state.transport);
      await disableFunnel(state.transport);
    }
    await compose(['stop'], 'Mobile preview shutdown', Boolean(state.firebase));
    console.log('Mobile preview stopped. Its database and photos are preserved.');
  } else {
    const healthy = state.origin ? await ready(currentOrigin(state.origin)) : false;
    console.log(
      healthy
        ? 'KidQuest mobile preview is ready: ' + state.origin
        : 'Mobile preview is not reachable. Run pnpm mobile:start.',
    );
  }
} catch (error) {
  if (['start', 'resume'].includes(mode) && state && operationLock && startedTunnel)
    await compose(['stop', 'tunnel'], 'Tunnel shutdown', true).catch(() => undefined);
  console.error(error instanceof Error ? error.message : 'Mobile preview failed.');
  process.exitCode = 1;
} finally {
  if (operationLock) {
    await operationLock.close();
    await unlink(lockFile);
  }
}
