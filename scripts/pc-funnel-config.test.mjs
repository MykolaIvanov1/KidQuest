import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUNNEL_LOOPBACK_PORT,
  validateFunnelTransport,
  funnelOrigin,
  validateFunnelOrigin,
  funnelOverride,
  validateFunnelComposeServices,
} from './pc-funnel-config.mjs';

const transport = { type: 'tailscale', hostname: 'family-pc.tail12345.ts.net', port: 5188 };
function services() {
  return {
    db: { restart: 'unless-stopped' },
    migrate: { restart: 'no' },
    api: { restart: 'unless-stopped', read_only: true },
    web: {
      restart: 'unless-stopped',
      read_only: true,
      ports: [
        { host_ip: '127.0.0.1', published: '5188', target: 80, protocol: 'tcp', mode: 'ingress' },
      ],
    },
  };
}

test('Funnel transport uses the exact local authenticated Tailscale identity and fixed loopback port', () => {
  assert.equal(FUNNEL_LOOPBACK_PORT, 5188);
  assert.deepEqual(validateFunnelTransport(transport, transport.hostname), transport);
  assert.deepEqual(
    validateFunnelTransport({ ...transport, hostname: transport.hostname.toUpperCase() }),
    transport,
  );
  assert.throws(() => validateFunnelTransport(transport, 'another-pc.tail12345.ts.net'));
  assert.equal(funnelOrigin(transport), 'https://' + transport.hostname);
});

test('Funnel transport refuses unpinned URLs, unsafe hostname syntax and unrelated settings without echoing them', () => {
  const invalid = [
    null,
    [],
    { ...transport, type: 'quick' },
    { ...transport, port: 80 },
    { ...transport, port: '5188' },
    { ...transport, extra: 'private' },
    ...[
      'family-pc.tail12345.ts.net.',
      'https://family-pc.tail12345.ts.net',
      'https://user:private@example.test',
      'family-pc.tail12345.ts.net:443',
      'family-pc.tail12345.ts.net.evil.test',
      'family-pc.tail12345.ts.net/path',
      'family-pc.tail12345.ts.net?next=external',
      'family-pc.ts.net',
      'family_pc.tail12345.ts.net',
      '-family-pc.tail12345.ts.net',
      'family-pc-.tail12345.ts.net',
      '127.0.0.1',
      ' family-pc.tail12345.ts.net',
    ].map((hostname) => ({ ...transport, hostname })),
  ];
  for (const value of invalid)
    assert.throws(() => validateFunnelTransport(value), {
      message: 'Invalid approved Tailscale transport configuration.',
    });
});

test('Funnel origin must equal the approved HTTPS origin without userinfo, path or alternate host', () => {
  const expected = funnelOrigin(transport);
  assert.equal(validateFunnelOrigin(expected, transport), expected);
  for (const origin of [
    expected + '/',
    expected + '?next=external',
    expected + '#fragment',
    expected + '.evil.test',
    expected.replace('https:', 'http:'),
    expected.replace('family-pc', 'other-pc'),
    expected.replace('https://', 'https://private@'),
    expected + ':443',
    'https://family.trycloudflare.com',
  ])
    assert.throws(() => validateFunnelOrigin(origin, transport));
});

test('Funnel override replaces public Compose ports and publishes only IPv4 loopback web ingress', () => {
  const source = funnelOverride('C:/KidQuest родина/.local/mobile-preview', transport);
  assert.match(source, /ports: !override/);
  assert.match(source, /host_ip: 127\.0\.0\.1/);
  assert.match(source, /published: '5188'/);
  assert.match(source, /target: 80/);
  assert.match(source, /protocol: tcp/);
  assert.match(source, /read_only: true/);
  assert.match(source, /restart: unless-stopped/);
  assert.match(source, /source: "C:\/KidQuest родина\/.local\/mobile-preview\/Caddyfile"/);
  assert.doesNotMatch(source, /cloudflared|tunnel:|0\.0\.0\.0|5432:|4000:|network_mode: host/);
});

test('Funnel effective services accept exactly one web listener with inherited runtime protections', () => {
  assert.doesNotThrow(() => validateFunnelComposeServices(services(), transport));
  const model = services();
  delete model.web.ports[0].mode;
  assert.doesNotThrow(() => validateFunnelComposeServices(model, transport));
});

test('Funnel effective services reject public, extra and malformed ports and weakened startup or filesystem settings', () => {
  const mutations = [
    (value) => {
      value.web.ports[0].host_ip = '0.0.0.0';
    },
    (value) => {
      delete value.web.ports[0].host_ip;
    },
    (value) => {
      value.web.ports[0].host_ip = '::';
    },
    (value) => {
      value.web.ports[0].published = '5188-5190';
    },
    (value) => {
      value.web.ports[0].published = '5189';
    },
    (value) => {
      value.web.ports[0].target = 4000;
    },
    (value) => {
      value.web.ports[0].protocol = 'udp';
    },
    (value) => {
      value.web.ports[0].mode = 'host';
    },
    (value) => {
      value.web.ports[0].unreviewed = 'value';
    },
    (value) => {
      value.web.ports.push({ ...value.web.ports[0], published: '5190' });
    },
    (value) => {
      value.web.ports = ['127.0.0.1:5188:80'];
    },
    (value) => {
      value.web.ports = [];
    },
    (value) => {
      value.api.ports = [
        { host_ip: '127.0.0.1', published: '4000', target: 4000, protocol: 'tcp' },
      ];
    },
    (value) => {
      value.db.ports = [{ published: '5432', target: 5432 }];
    },
    (value) => {
      value.api.read_only = false;
    },
    (value) => {
      value.web.read_only = false;
    },
    (value) => {
      value.api.restart = 'no';
    },
    (value) => {
      value.migrate.restart = 'always';
    },
    (value) => {
      value.tunnel = {};
    },
    (value) => {
      value.other = {};
    },
  ];
  for (const mutate of mutations) {
    const model = services();
    mutate(model);
    assert.throws(() => validateFunnelComposeServices(model, transport), {
      message: 'Invalid approved Tailscale transport configuration.',
    });
  }
});
