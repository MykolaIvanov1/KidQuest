import { spawn } from 'node:child_process';
import { FUNNEL_LOOPBACK_PORT, validateFunnelTransport } from './pc-funnel-config.mjs';

const unavailable = () =>
  new Error('Tailscale is unavailable or not signed in. Start Tailscale, sign in, and retry.');
const conflicting = () =>
  new Error('Tailscale HTTPS port 443 has an unrelated service. No changes were applied.');
const needsApproval = () =>
  new Error(
    'Tailscale Funnel could not be enabled. Open Tailscale and approve HTTPS/Funnel if requested, then retry. Private command output was not logged.',
  );
const inactive = () => new Error('The approved KidQuest Funnel is not active.');
const outputLimit = 1_048_576;
const target = (transport) => 'http://127.0.0.1:' + transport.port;
const dictionary = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function map(value) {
  if (value === undefined || value === null) return {};
  if (!dictionary(value)) throw conflicting();
  return value;
}
function json(output) {
  if (typeof output !== 'string' || output.length > outputLimit) throw unavailable();
  try {
    return JSON.parse(output);
  } catch {
    throw unavailable();
  }
}

/** Only the local signed-in device's DNS identity is returned, never peers, IPs or user details. */
export function parseTailscaleTransport(status) {
  try {
    if (!dictionary(status) || status.BackendState !== 'Running') throw unavailable();
    const name = status.Self?.DNSName;
    if (typeof name !== 'string') throw unavailable();
    return validateFunnelTransport({
      type: 'tailscale',
      hostname: name.endsWith('.') ? name.slice(0, -1) : name,
      port: FUNNEL_LOOPBACK_PORT,
    });
  } catch {
    throw unavailable();
  }
}

function usesDevice443(config) {
  return (
    Object.hasOwn(map(config.TCP), '443') ||
    Object.keys(map(config.Web)).some((key) => key.endsWith(':443')) ||
    Object.keys(map(config.AllowFunnel)).some((key) => key.endsWith(':443'))
  );
}

/**
 * Empty device port 443 is available. An existing public root is owned only when it is exactly
 * the approved HTTP loopback proxy. Other ports and service-specific virtual IPs are untouched.
 */
export function parseFunnelOwnership(config, metadata) {
  const transport = validateFunnelTransport(metadata);
  if (config === null || config === undefined) return false;
  if (!dictionary(config)) throw conflicting();
  for (const foreground of Object.values(map(config.Foreground))) {
    if (!dictionary(foreground) || usesDevice443(foreground)) throw conflicting();
  }
  if (!usesDevice443(config)) return false;
  const hostPort = transport.hostname + ':443';
  const tcp = map(config.TCP)['443'];
  const web = map(config.Web);
  const allowed = map(config.AllowFunnel);
  const server = web[hostPort];
  const handlers = dictionary(server) ? server.Handlers : undefined;
  const handler = dictionary(handlers) ? handlers['/'] : undefined;
  if (
    !dictionary(tcp) ||
    tcp.HTTPS !== true ||
    Object.keys(tcp).some((key) => key !== 'HTTPS') ||
    Object.keys(web).some((key) => key.endsWith(':443') && key !== hostPort) ||
    Object.keys(allowed).some((key) => key.endsWith(':443') && key !== hostPort) ||
    !dictionary(server) ||
    Object.keys(server).length !== 1 ||
    !dictionary(handlers) ||
    Object.keys(handlers).length !== 1 ||
    !dictionary(handler) ||
    Object.keys(handler).length !== 1 ||
    ![target(transport), target(transport) + '/'].includes(handler.Proxy) ||
    allowed[hostPort] !== true
  )
    throw conflicting();
  // A private Serve root is deliberately refused: `funnel off` would remove that pre-existing route.
  return true;
}

function runTailscale(args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let settled = false;
    let output = '';
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    try {
      child = spawn(
        process.platform === 'win32' ? 'C:/Program Files/Tailscale/tailscale.exe' : 'tailscale',
        args,
        { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      timer = setTimeout(() => {
        child.kill();
        finish(unavailable());
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.length > outputLimit) {
          child.kill();
          finish(unavailable());
        }
      });
      // CLI diagnostics can contain sign-in/approval links or private tailnet information.
      child.stderr.resume();
      child.once('error', () => finish(unavailable()));
      child.once('close', (code) => finish(code === 0 ? null : unavailable()));
    } catch {
      child?.kill();
      finish(unavailable());
    }
  });
}
async function command(args, options) {
  try {
    return await (options.run || runTailscale)(args, { timeoutMs: options.timeoutMs || 15_000 });
  } catch {
    throw unavailable();
  }
}
export async function readTailscaleTransport(options = {}) {
  return parseTailscaleTransport(json(await command(['status', '--json'], options)));
}
async function currentOwnership(metadata, options) {
  const transport = validateFunnelTransport(metadata);
  const identity = await readTailscaleTransport(options);
  validateFunnelTransport(transport, identity.hostname);
  const config = json(await command(['funnel', 'status', '--json'], options));
  return { transport, owned: parseFunnelOwnership(config, transport) };
}

/** Returns true only if this exact public KidQuest root was already present. */
export async function checkFunnelOwnership(metadata, options = {}) {
  return (await currentOwnership(metadata, options)).owned;
}
export async function verifyFunnel(metadata, options = {}) {
  const current = await currentOwnership(metadata, options);
  if (!current.owned) throw inactive();
  return current.transport;
}
export async function enableFunnel(metadata, options = {}) {
  const current = await currentOwnership(metadata, options);
  if (current.owned) return current.transport;
  try {
    await command(['funnel', '--bg', '--yes', '--https=443', target(current.transport)], {
      ...options,
      timeoutMs: 45_000,
    });
  } catch {
    throw needsApproval();
  }
  return verifyFunnel(current.transport, options);
}

/** Remove only the approved root on device port 443; never use a global Funnel reset. */
export async function disableFunnel(metadata, options = {}) {
  const current = await currentOwnership(metadata, options);
  if (!current.owned) return false;
  try {
    await command(
      ['funnel', '--bg', '--yes', '--https=443', target(current.transport), 'off'],
      options,
    );
  } catch {
    throw new Error(
      'The approved KidQuest Funnel could not be disabled. Private output was not logged.',
    );
  }
  if ((await currentOwnership(current.transport, options)).owned)
    throw new Error('The approved KidQuest Funnel is still active.');
  return true;
}
