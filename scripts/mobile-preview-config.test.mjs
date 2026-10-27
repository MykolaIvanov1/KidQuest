import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, generateKeyPairSync } from 'node:crypto';
import { parse } from 'dotenv';
import { validateFirebaseConfiguration } from './firebase-config.mjs';
import {
  quickTunnelOrigin,
  validateMobileOrigin,
  validateMobileProject,
  mobileOverride,
  mobileProcessEnvironment,
  validateMobileComposeConfig,
  mobileFirebaseEnvironment,
  mobileApprovedFirebase,
  firebaseFingerprint,
} from './mobile-preview-config.mjs';

test('mobile commands refuse production or arbitrary project names', () => {
  assert.equal(validateMobileProject('kidquest-mobile-a1b2c3d4'), 'kidquest-mobile-a1b2c3d4');
  for (const name of [
    'kidquest-production',
    'kidquest-qa-test',
    '../mobile',
    'kidquest-mobile-a1b2c3d4 --all',
  ])
    assert.throws(() => validateMobileProject(name));
});
test('mobile origin accepts only a plain HTTPS Quick Tunnel origin', () => {
  assert.equal(
    validateMobileOrigin('https://family-test.trycloudflare.com'),
    'https://family-test.trycloudflare.com',
  );
  for (const value of [
    'http://family.trycloudflare.com',
    'https://family.trycloudflare.com.evil.test',
    'https://family.trycloudflare.com/path',
    'https://user:secret@family.trycloudflare.com',
    'https://family.trycloudflare.com:444',
    'https://family.trycloudflare.com?next=external',
    'https://localhost',
  ])
    assert.throws(() => validateMobileOrigin(value));
});
test('tunnel logs select the most recent generated origin without credentials', () => {
  assert.equal(quickTunnelOrigin('connecting...'), null);
  assert.equal(
    quickTunnelOrigin('https://first.trycloudflare.com\nhttps://next.trycloudflare.com'),
    'https://next.trycloudflare.com',
  );
});
test('mobile override publishes no host ports and uses a separate connector', () => {
  const source = mobileOverride('C:/KidQuest/.local/mobile-preview');
  assert.match(source, /ports: !reset \[\]/);
  assert.match(source, /cloudflare\/cloudflared:2026\.10\.4@sha256:/);
  assert.match(source, /http:\/\/web:80/);
  assert.doesNotMatch(source, /host\.docker\.internal|host_network|5432:|4000:/);
});

const project = 'kidquest-mobile-a1b2c3d4';
// Synthetic test-only values, never used by a running service.
const databaseUrl =
  'postgresql://kidquest_mobile:test-only-mobile-password@db:5432/kidquest_mobile?schema=public&connection_limit=4';
const mobileEnvironment = [
  'POSTGRES_USER=kidquest_mobile',
  'POSTGRES_DB=kidquest_mobile',
  'POSTGRES_PASSWORD=test-only-mobile-password',
  'DATABASE_URL=' + databaseUrl,
  'JWT_SECRET=test-only-mobile-secret-for-environment-validation',
  'KIDQUEST_DOMAIN=phone-test.trycloudflare.com',
  'KIDQUEST_IMAGE_TAG=local',
  'FIREBASE_PROJECT_ID=',
  'FIREBASE_CLIENT_EMAIL=',
  'FIREBASE_PRIVATE_KEY=',
  'VITE_FIREBASE_API_KEY=',
  'VITE_FIREBASE_PROJECT_ID=',
  'VITE_FIREBASE_MESSAGING_SENDER_ID=',
  'VITE_FIREBASE_APP_ID=',
  'VITE_FIREBASE_VAPID_KEY=',
].join('\n');
function effectiveMobileConfig(content = mobileEnvironment) {
  const environment = mobileProcessEnvironment(content, {});
  const firebase = Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.startsWith('FIREBASE_')),
  );
  const publicFirebase = Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.startsWith('VITE_FIREBASE_')),
  );
  return {
    name: project,
    services: {
      db: {
        environment: {
          POSTGRES_USER: environment.POSTGRES_USER,
          POSTGRES_DB: environment.POSTGRES_DB,
          POSTGRES_PASSWORD: environment.POSTGRES_PASSWORD,
        },
      },
      api: {
        image: 'kidquest-api:' + environment.KIDQUEST_IMAGE_TAG,
        environment: {
          DATABASE_URL: environment.DATABASE_URL,
          JWT_SECRET: environment.JWT_SECRET,
          NODE_ENV: 'production',
          FRONTEND_URL: 'https://' + environment.KIDQUEST_DOMAIN,
          ...firebase,
        },
      },
      migrate: {
        image: 'kidquest-migrate:' + environment.KIDQUEST_IMAGE_TAG,
        environment: { DATABASE_URL: environment.DATABASE_URL },
      },
      web: {
        image: 'kidquest-web:' + environment.KIDQUEST_IMAGE_TAG,
        environment: { KIDQUEST_DOMAIN: environment.KIDQUEST_DOMAIN },
        ports: [],
        build: { args: publicFirebase },
      },
      tunnel: {},
    },
  };
}
test('mobile child environment overrides ambient database, Firebase and domain while preserving PATH', () => {
  const inherited = {
    PATH: 'test/path',
    DATABASE_URL: 'postgresql://operator:private@remote.example/working',
    POSTGRES_PASSWORD: 'ambient-private-password',
    FIREBASE_PROJECT_ID: 'live-project',
    FIREBASE_PRIVATE_KEY: 'ambient-private-key',
    VITE_FIREBASE_API_KEY: 'live-public-key',
    KIDQUEST_DOMAIN: 'working.example.com',
  };
  const actual = mobileProcessEnvironment(mobileEnvironment, inherited);
  assert.equal(actual.PATH, 'test/path');
  assert.equal(actual.DATABASE_URL, databaseUrl);
  assert.equal(actual.POSTGRES_PASSWORD, 'test-only-mobile-password');
  assert.equal(actual.FIREBASE_PROJECT_ID, '');
  assert.equal(actual.FIREBASE_PRIVATE_KEY, '');
  assert.equal(actual.VITE_FIREBASE_API_KEY, '');
  assert.equal(actual.KIDQUEST_DOMAIN, 'phone-test.trycloudflare.com');
  assert.equal(inherited.POSTGRES_PASSWORD, 'ambient-private-password');
});
test('effective mobile Compose model accepts isolated generated settings without published ports', () => {
  assert.doesNotThrow(() =>
    validateMobileComposeConfig(effectiveMobileConfig(), mobileEnvironment, project),
  );
});
test('effective mobile Compose validation rejects substituted databases, credentials, Firebase, origins and ports without exposing details', () => {
  const mutations = [
    (config) => {
      config.services.api.environment.DATABASE_URL =
        'postgresql://private:password@remote.example/working';
    },
    (config) => {
      config.services.migrate.environment.DATABASE_URL =
        'postgresql://private:password@remote.example/working';
    },
    (config) => {
      config.services.db.environment.POSTGRES_PASSWORD = 'private-password';
    },
    (config) => {
      config.services.db.environment.POSTGRES_USER = 'working-user';
    },
    (config) => {
      config.services.db.environment.POSTGRES_DB = 'working-db';
    },
    (config) => {
      config.services.api.environment.JWT_SECRET = 'ambient-secret';
    },
    (config) => {
      config.services.api.environment.NODE_ENV = 'development';
    },
    (config) => {
      config.services.api.environment.FIREBASE_PRIVATE_KEY = 'private-key';
    },
    (config) => {
      config.services.web.build.args.VITE_FIREBASE_PROJECT_ID = 'live-project';
    },
    (config) => {
      config.services.api.environment.FRONTEND_URL = 'https://wrong.trycloudflare.com';
    },
    (config) => {
      config.services.web.environment.KIDQUEST_DOMAIN = 'wrong.trycloudflare.com';
    },
    (config) => {
      config.services.web.ports = [{ published: '80', target: 80 }];
    },
    (config) => {
      config.services.db.ports = [{ published: '5432', target: 5432 }];
    },
    (config) => {
      config.name = 'kidquest-production';
    },
    (config) => {
      config.services.web.image = 'unreviewed-image:latest';
    },
  ];
  for (const mutate of mutations) {
    const config = effectiveMobileConfig();
    mutate(config);
    assert.throws(() => validateMobileComposeConfig(config, mobileEnvironment, project), {
      message: 'Mobile preview configuration is not isolated. No public startup was allowed.',
    });
  }
  assert.throws(
    () =>
      validateMobileComposeConfig(
        effectiveMobileConfig(),
        mobileEnvironment.replace(
          databaseUrl,
          'postgresql://private:password@remote.example/working',
        ),
        project,
      ),
    { message: 'Mobile preview configuration is not isolated. No public startup was allowed.' },
  );
});

test('tunnel parser never truncates an untrusted URL into an allowed hostname', () => {
  for (const value of [
    'https://probe.trycloudflare.com.evil.test',
    'https://probe.trycloudflare.com:444',
    'https://probe.trycloudflare.com/path',
    'https://user:secret@probe.trycloudflare.com',
  ])
    assert.equal(quickTunnelOrigin(value), null);
});

const syntheticVapid = createECDH('prime256v1');
syntheticVapid.generateKeys();
const syntheticPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const approvedFirebase = validateFirebaseConfiguration(
  {
    type: 'service_account',
    project_id: 'kidquest-test',
    client_email: 'firebase-adminsdk-test@kidquest-test.iam.gserviceaccount.com',
    private_key: syntheticPrivateKey,
  },
  {
    apiKey: 'AIza' + 'a'.repeat(35),
    projectId: 'kidquest-test',
    messagingSenderId: '123456789012',
    appId: '1:123456789012:web:synthetic-test',
    vapidKey: syntheticVapid.getPublicKey().toString('base64url'),
  },
);

test('Firebase attachment replaces only the eight allowed fields and preserves local database, domain and JWT', () => {
  const before = '# local mobile preview\r\n' + mobileEnvironment.replaceAll('\n', '\r\n') + '\r\n';
  const result = mobileFirebaseEnvironment(before, approvedFirebase);
  const parsed = parse(result);
  for (const [key, value] of Object.entries(parse(before))) {
    assert.equal(
      parsed[key],
      { ...approvedFirebase.server, ...approvedFirebase.web }[key] ?? value,
    );
  }
  assert.equal(parsed.FIREBASE_PRIVATE_KEY, approvedFirebase.server.FIREBASE_PRIVATE_KEY);
  assert.ok(result.startsWith('# local mobile preview\r\n'));
  assert.ok(result.includes('DATABASE_URL=' + databaseUrl + '\r\n'));
  assert.ok(!result.includes('-----BEGIN PRIVATE KEY-----\n'));
  assert.equal(mobileFirebaseEnvironment(result, approvedFirebase), result);
  assert.throws(() =>
    mobileFirebaseEnvironment(
      before.replace('FIREBASE_CLIENT_EMAIL=', 'MISSING='),
      approvedFirebase,
    ),
  );
  assert.throws(() =>
    mobileFirebaseEnvironment(before + 'FIREBASE_PROJECT_ID=\r\n', approvedFirebase),
  );
});

test('effective Compose accepts Firebase only with the exact explicitly approved pair', () => {
  const content = mobileFirebaseEnvironment(mobileEnvironment, approvedFirebase);
  const model = effectiveMobileConfig(content);
  assert.doesNotThrow(() => validateMobileComposeConfig(model, content, project, approvedFirebase));
  assert.throws(() => validateMobileComposeConfig(model, content, project));
  assert.throws(() =>
    validateMobileComposeConfig(model, mobileEnvironment, project, approvedFirebase),
  );
  const other = structuredClone(approvedFirebase);
  other.web.VITE_FIREBASE_API_KEY = 'AIza' + 'b'.repeat(35);
  assert.throws(() => validateMobileComposeConfig(model, content, project, other));
});

test('Firebase effective model rejects partial, mismatched and private build configuration without logging keys', () => {
  const content = mobileFirebaseEnvironment(mobileEnvironment, approvedFirebase);
  const mutations = [
    (model) => {
      model.services.api.environment.FIREBASE_PRIVATE_KEY = '';
    },
    (model) => {
      model.services.api.environment.FIREBASE_PROJECT_ID = 'other-project';
    },
    (model) => {
      model.services.web.build.args.VITE_FIREBASE_PROJECT_ID = 'other-project';
    },
    (model) => {
      model.services.web.build.args.FIREBASE_PRIVATE_KEY = syntheticPrivateKey;
    },
    (model) => {
      model.services.web.build.args.JWT_SECRET = 'private';
    },
    (model) => {
      model.services.api.build = { args: { FIREBASE_PRIVATE_KEY: syntheticPrivateKey } };
    },
    (model) => {
      model.services.web.build.secrets = [{ source: 'private-key' }];
    },
  ];
  for (const mutate of mutations) {
    const model = effectiveMobileConfig(content);
    mutate(model);
    assert.throws(() => validateMobileComposeConfig(model, content, project, approvedFirebase), {
      message: 'Mobile preview configuration is not isolated. No public startup was allowed.',
    });
  }
});

test('approved metadata pins the complete Firebase pair and supports restoring previous configuration', () => {
  const content = mobileFirebaseEnvironment(mobileEnvironment, approvedFirebase);
  const metadata = {
    projectId: approvedFirebase.projectId,
    fingerprint: firebaseFingerprint(approvedFirebase),
  };
  assert.deepEqual(mobileApprovedFirebase(content, metadata), approvedFirebase);
  assert.equal(mobileApprovedFirebase(mobileEnvironment, undefined), null);
  assert.throws(() => mobileApprovedFirebase(content, { ...metadata, projectId: 'other-project' }));
  const changed = content.replace(
    approvedFirebase.web.VITE_FIREBASE_API_KEY,
    'AIza' + 'b'.repeat(35),
  );
  assert.throws(() => mobileApprovedFirebase(changed, metadata), {
    message: 'Approved mobile Firebase configuration changed. No public startup was allowed.',
  });
  assert.throws(() => mobileApprovedFirebase(mobileEnvironment, metadata));
});
import { funnelOrigin } from './pc-funnel-config.mjs';

const approvedTransport = {
  type: 'tailscale',
  hostname: 'family-pc.tail12345.ts.net',
  port: 5188,
};
const funnelEnvironment = mobileEnvironment.replace(
  'phone-test.trycloudflare.com',
  approvedTransport.hostname,
);
function effectiveFunnelConfig(content = funnelEnvironment) {
  const model = effectiveMobileConfig(content);
  delete model.services.tunnel;
  for (const name of ['db', 'api', 'web']) model.services[name].restart = 'unless-stopped';
  model.services.migrate.restart = 'no';
  model.services.api.read_only = true;
  model.services.web.read_only = true;
  model.services.web.ports = [
    { host_ip: '127.0.0.1', published: '5188', target: 80, protocol: 'tcp', mode: 'ingress' },
  ];
  return model;
}

test('Funnel accepts the approved canonical origin and loopback ingress only with explicit transport metadata', () => {
  const model = effectiveFunnelConfig();
  assert.equal(model.services.api.environment.FRONTEND_URL, funnelOrigin(approvedTransport));
  assert.doesNotThrow(() =>
    validateMobileComposeConfig(model, funnelEnvironment, project, null, approvedTransport),
  );
  assert.throws(() => validateMobileComposeConfig(model, funnelEnvironment, project));
  assert.throws(() =>
    validateMobileComposeConfig(model, funnelEnvironment, project, null, {
      ...approvedTransport,
      hostname: 'other-pc.tail12345.ts.net',
    }),
  );
});

test('Funnel retains Firebase approval, private build boundaries and database isolation checks', () => {
  const content = mobileFirebaseEnvironment(funnelEnvironment, approvedFirebase);
  assert.doesNotThrow(() =>
    validateMobileComposeConfig(
      effectiveFunnelConfig(content),
      content,
      project,
      approvedFirebase,
      approvedTransport,
    ),
  );
  const mutations = [
    (model) => {
      model.services.api.environment.DATABASE_URL =
        'postgresql://private:password@remote.test/working';
    },
    (model) => {
      model.services.api.environment.JWT_SECRET = 'ambient-private-secret';
    },
    (model) => {
      model.services.api.environment.FIREBASE_PROJECT_ID = 'other-project';
    },
    (model) => {
      model.services.web.build.args.FIREBASE_PRIVATE_KEY = syntheticPrivateKey;
    },
    (model) => {
      model.services.web.build.args.VITE_FIREBASE_PROJECT_ID = 'other-project';
    },
    (model) => {
      model.services.web.environment.KIDQUEST_DOMAIN = 'wrong.tail12345.ts.net';
    },
    (model) => {
      model.services.web.ports[0].host_ip = '0.0.0.0';
    },
    (model) => {
      model.services.extra = {};
    },
  ];
  for (const mutate of mutations) {
    const model = effectiveFunnelConfig(content);
    mutate(model);
    assert.throws(
      () =>
        validateMobileComposeConfig(model, content, project, approvedFirebase, approvedTransport),
      { message: 'Mobile preview configuration is not isolated. No public startup was allowed.' },
    );
  }
  assert.throws(() =>
    validateMobileComposeConfig(
      effectiveFunnelConfig(content),
      content,
      project,
      null,
      approvedTransport,
    ),
  );
});

test('quick transport refuses extra services even when they publish no host ports', () => {
  const model = effectiveMobileConfig();
  model.services.unreviewed = {};
  assert.throws(() => validateMobileComposeConfig(model, mobileEnvironment, project));
});
