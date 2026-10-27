import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTailscaleTransport,
  parseFunnelOwnership,
  readTailscaleTransport,
  checkFunnelOwnership,
  verifyFunnel,
  enableFunnel,
  disableFunnel,
} from './pc-funnel.mjs';

const transport = { type: 'tailscale', hostname: 'family-pc.tail12345.ts.net', port: 5188 };
const status = {
  BackendState: 'Running',
  Self: { DNSName: transport.hostname + '.', ID: 'private-node-id', TailscaleIPs: ['100.1.2.3'] },
  User: { example: { LoginName: 'private@example.test' } },
};
const proxy = 'http://127.0.0.1:5188';
const hostPort = transport.hostname + ':443';
function owned() {
  return {
    TCP: { 443: { HTTPS: true } },
    Web: { [hostPort]: { Handlers: { '/': { Proxy: proxy } } } },
    AllowFunnel: { [hostPort]: true },
  };
}
function fakeRunner(responses) {
  const calls = [];
  const run = async (args, options) => {
    calls.push({ args, options });
    assert.ok(responses.length, 'Unexpected command');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return typeof response === 'string' ? response : JSON.stringify(response);
  };
  return { calls, run, remaining: () => responses.length };
}

test('Tailscale status exposes only the signed-in self hostname and fixed loopback port', () => {
  assert.deepEqual(parseTailscaleTransport(status), transport);
  assert.deepEqual(
    parseTailscaleTransport({
      BackendState: 'Running',
      Self: { DNSName: 'FAMILY-PC.TAIL12345.TS.NET.' },
    }),
    transport,
  );
  for (const BackendState of ['NeedsLogin', 'Stopped', 'Starting', undefined])
    assert.throws(() => parseTailscaleTransport({ ...status, BackendState }));
  for (const DNSName of [
    '',
    'family-pc.tail12345.ts.net.evil.test',
    'https://family-pc.tail12345.ts.net',
    'family-pc.tail12345.ts.net/path',
    'family-pc.tail12345.ts.net:443',
    'family-pc.tail12345.ts.net..',
    ' family-pc.tail12345.ts.net',
    'localhost',
  ])
    assert.throws(() => parseTailscaleTransport({ ...status, Self: { DNSName } }));
});

test('empty device HTTPS port 443 is available without changing unrelated ports or services', () => {
  for (const config of [null, {}, { TCP: {}, Web: {}, AllowFunnel: {} }])
    assert.equal(parseFunnelOwnership(config, transport), false);
  const config = {
    TCP: { 8443: { HTTPS: true } },
    Web: { 'other.tail12345.ts.net:8443': { Handlers: { '/': { Text: 'unrelated' } } } },
    AllowFunnel: { 'other.tail12345.ts.net:8443': true },
    Services: { 'svc:other': { TCP: { 443: { HTTPS: true } } } },
    Foreground: { temporary: { TCP: { 10000: { HTTPS: true } } } },
  };
  assert.equal(parseFunnelOwnership(config, transport), false);
});

test('ownership requires exactly the approved public HTTPS root while preserving other ports', () => {
  const config = owned();
  config.TCP['8443'] = { HTTPS: true };
  config.Web[transport.hostname + ':8443'] = { Handlers: { '/': { Text: 'unrelated' } } };
  config.AllowFunnel[transport.hostname + ':8443'] = true;
  assert.equal(parseFunnelOwnership(config, transport), true);
  config.Web[hostPort].Handlers['/'].Proxy = proxy + '/';
  assert.equal(parseFunnelOwnership(config, transport), true);
});

test('ownership refuses a different target, foreign hostname, private Serve, extra paths or TCP forwarding', () => {
  const mutations = [
    (config) => {
      config.Web[hostPort].Handlers['/'].Proxy = 'http://127.0.0.1:5173';
    },
    (config) => {
      config.Web[hostPort].Handlers['/'].Proxy = 'http://127.0.0.1:5188/private';
    },
    (config) => {
      config.Web[hostPort].Handlers['/'].Proxy = 'http://localhost:5188';
    },
    (config) => {
      config.Web[hostPort].Handlers['/'].Proxy = 'http://127.0.0.1:5188?token=private';
    },
    (config) => {
      config.Web[hostPort].Handlers['/'].Text = 'unrelated';
    },
    (config) => {
      config.Web[hostPort].Handlers['/other'] = { Text: 'unrelated' };
    },
    (config) => {
      config.Web['other.tail12345.ts.net:443'] = config.Web[hostPort];
    },
    (config) => {
      config.AllowFunnel['other.tail12345.ts.net:443'] = true;
    },
    (config) => {
      config.AllowFunnel[hostPort] = false;
    },
    (config) => {
      delete config.AllowFunnel;
    },
    (config) => {
      config.TCP['443'].HTTPS = false;
    },
    (config) => {
      config.TCP['443'].TCPForward = '127.0.0.1:5188';
    },
    (config) => {
      delete config.TCP;
    },
    (config) => {
      delete config.Web;
    },
    (config) => {
      config.Foreground = { interactive: owned() };
    },
  ];
  for (const mutate of mutations) {
    const config = owned();
    mutate(config);
    assert.throws(() => parseFunnelOwnership(config, transport), {
      message: 'Tailscale HTTPS port 443 has an unrelated service. No changes were applied.',
    });
  }
  for (const invalid of [[], 'private-output', { TCP: [] }, { Foreground: ['private'] }])
    assert.throws(() => parseFunnelOwnership(invalid, transport));
});

test('metadata is validated before any CLI action and must match the current authenticated device', async () => {
  const runtime = fakeRunner([status]);
  await assert.rejects(() => checkFunnelOwnership({ ...transport, port: 4000 }, runtime));
  assert.equal(runtime.calls.length, 0);
  await assert.rejects(() =>
    checkFunnelOwnership({ ...transport, hostname: 'other.tail12345.ts.net' }, runtime),
  );
  assert.equal(runtime.calls.length, 1);
  assert.deepEqual(runtime.calls[0].args, ['status', '--json']);
});

test('read and check operations never mutate the tailnet', async () => {
  const runtime = fakeRunner([status, status, {}, status, owned()]);
  assert.deepEqual(await readTailscaleTransport(runtime), transport);
  assert.equal(await checkFunnelOwnership(transport, runtime), false);
  assert.equal(await checkFunnelOwnership(transport, runtime), true);
  assert.deepEqual(
    runtime.calls.map((call) => call.args),
    [
      ['status', '--json'],
      ['status', '--json'],
      ['funnel', 'status', '--json'],
      ['status', '--json'],
      ['funnel', 'status', '--json'],
    ],
  );
});

test('enable targets only approved HTTP loopback in background and verifies active public config', async () => {
  const runtime = fakeRunner([status, {}, 'private-command-output', status, owned()]);
  assert.deepEqual(await enableFunnel(transport, runtime), transport);
  assert.deepEqual(runtime.calls[2].args, ['funnel', '--bg', '--yes', '--https=443', proxy]);
  assert.equal(runtime.calls[2].options.timeoutMs, 45_000);
  assert.equal(runtime.remaining(), 0);
});

test('enabling the existing owned Funnel is idempotent and conflicting services are untouched', async () => {
  const existing = fakeRunner([status, owned()]);
  assert.deepEqual(await enableFunnel(transport, existing), transport);
  assert.equal(existing.calls.length, 2);
  const foreign = owned();
  foreign.Web[hostPort].Handlers['/'].Proxy = 'http://127.0.0.1:9000';
  const runtime = fakeRunner([status, foreign]);
  await assert.rejects(() => enableFunnel(transport, runtime));
  assert.equal(runtime.calls.length, 2);
});

test('disabled or changed config after enabling is not falsely reported active', async () => {
  const runtime = fakeRunner([status, {}, '', status, {}]);
  await assert.rejects(() => enableFunnel(transport, runtime), {
    message: 'The approved KidQuest Funnel is not active.',
  });
  const verification = fakeRunner([status, {}]);
  await assert.rejects(() => verifyFunnel(transport, verification));
});

test('disable removes only the owned HTTPS root, verifies removal and never resets other services', async () => {
  const unrelated = { TCP: { 8443: { HTTPS: true } } };
  const runtime = fakeRunner([status, owned(), '', status, unrelated]);
  assert.equal(await disableFunnel(transport, runtime), true);
  assert.deepEqual(runtime.calls[2].args, ['funnel', '--bg', '--yes', '--https=443', proxy, 'off']);
  assert.ok(runtime.calls.every(({ args }) => !args.includes('reset')));
  assert.equal(runtime.remaining(), 0);
});

test('disable is a no-op when absent and refuses changed ownership', async () => {
  const absent = fakeRunner([status, {}]);
  assert.equal(await disableFunnel(transport, absent), false);
  assert.equal(absent.calls.length, 2);
  const changed = owned();
  changed.Web[hostPort].Handlers['/'].Proxy = 'http://127.0.0.1:8080';
  const runtime = fakeRunner([status, changed]);
  await assert.rejects(() => disableFunnel(transport, runtime));
  assert.equal(runtime.calls.length, 2);
});

test('provider diagnostics and malformed private JSON never escape through errors', async () => {
  const secret = 'private-authorization-link-and-user@example.test';
  const commandFailure = fakeRunner([new Error(secret)]);
  await assert.rejects(
    () => readTailscaleTransport(commandFailure),
    (error) => !error.message.includes(secret),
  );
  for (const raw of ['{' + secret, secret, 'x'.repeat(1_048_577)]) {
    const runtime = fakeRunner([raw]);
    await assert.rejects(
      () => readTailscaleTransport(runtime),
      (error) => !error.message.includes(secret),
    );
  }
  const approval = fakeRunner([status, {}, new Error(secret)]);
  await assert.rejects(
    () => enableFunnel(transport, approval),
    (error) => error.message.includes('approve HTTPS/Funnel') && !error.message.includes(secret),
  );
  const disabling = fakeRunner([status, owned(), new Error(secret)]);
  await assert.rejects(
    () => disableFunnel(transport, disabling),
    (error) => !error.message.includes(secret),
  );
});
