import path from 'node:path';

export const FUNNEL_LOOPBACK_PORT = 5188;
const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const hostnamePattern = new RegExp(`^${label}\\.${label}\\.ts\\.net$`);
const invalid = () => new Error('Invalid approved Tailscale transport configuration.');

function hostname(value) {
  if (typeof value !== 'string' || value !== value.trim()) throw invalid();
  const normalized = value.toLowerCase();
  if (!hostnamePattern.test(normalized)) throw invalid();
  return normalized;
}

/** A Funnel hostname must come from the authenticated local Tailscale identity. */
export function validateFunnelTransport(value, authenticatedHostname) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    Object.keys(value).some((key) => !['type', 'hostname', 'port'].includes(key)) ||
    value.type !== 'tailscale' ||
    value.port !== FUNNEL_LOOPBACK_PORT
  )
    throw invalid();
  const current = { type: 'tailscale', hostname: hostname(value.hostname), port: value.port };
  if (authenticatedHostname !== undefined && current.hostname !== hostname(authenticatedHostname))
    throw invalid();
  return current;
}

export function funnelOrigin(value) {
  return 'https://' + validateFunnelTransport(value).hostname;
}

/** Do not accept a different ts.net host, an arbitrary external origin or a URL suffix. */
export function validateFunnelOrigin(value, transport) {
  const expected = funnelOrigin(transport);
  if (typeof value !== 'string' || value !== expected) throw invalid();
  return expected;
}

export function funnelOverride(folder, transport) {
  const current = validateFunnelTransport(transport);
  return `services:
  db:
    restart: unless-stopped
  api:
    restart: unless-stopped
    read_only: true
  web:
    restart: unless-stopped
    read_only: true
    ports: !override
      - target: 80
        published: '${current.port}'
        host_ip: 127.0.0.1
        protocol: tcp
    volumes:
      - type: bind
        source: ${JSON.stringify(path.join(folder, 'Caddyfile').replaceAll('\\', '/'))}
        target: /etc/caddy/Caddyfile
        read_only: true
`;
}

/** This transport publishes only the web entry point to the host's IPv4 loopback. */
export function validateFunnelComposeServices(services, transport) {
  const current = validateFunnelTransport(transport);
  if (
    !services ||
    typeof services !== 'object' ||
    Object.keys(services).some((name) => !['db', 'migrate', 'api', 'web'].includes(name)) ||
    Object.keys(services).length !== 4 ||
    ['db', 'api', 'web'].some((name) => services[name]?.restart !== 'unless-stopped') ||
    services.migrate?.restart !== 'no' ||
    services.api?.read_only !== true ||
    services.web?.read_only !== true ||
    Object.entries(services).some(([name, service]) => name !== 'web' && service.ports?.length)
  )
    throw invalid();
  const ports = services.web.ports;
  if (!Array.isArray(ports) || ports.length !== 1) throw invalid();
  const entry = ports[0];
  if (
    !entry ||
    typeof entry !== 'object' ||
    Array.isArray(entry) ||
    entry.host_ip !== '127.0.0.1' ||
    entry.target !== 80 ||
    entry.published !== String(current.port) ||
    entry.protocol !== 'tcp' ||
    (entry.mode !== undefined && entry.mode !== 'ingress') ||
    Object.keys(entry).some(
      (key) => !['host_ip', 'target', 'published', 'protocol', 'mode'].includes(key),
    )
  )
    throw invalid();
}
