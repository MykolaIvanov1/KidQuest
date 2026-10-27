import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { validateFunnelTransport, validateFunnelComposeServices } from './pc-funnel-config.mjs';
import {
  FIREBASE_SERVER_KEYS,
  FIREBASE_WEB_KEYS,
  validateFirebaseEnvironment,
} from './firebase-config.mjs';
export const tunnelImage =
  'cloudflare/cloudflared:2026.10.4@sha256:c6c7ae1d5dfdcb094ad344ed68ccffc26635c9c6be80965664c33baf064b0515';
export function validateMobileProject(value) {
  if (!/^kidquest-mobile-[a-f0-9]{8}$/.test(value)) throw new Error('Invalid mobile test project.');
  return value;
}
export function quickTunnelOrigin(log) {
  const candidates = [...log.matchAll(/https:\/\/[^\s|"'<>]+/g)].reverse();
  for (const candidate of candidates) {
    try {
      return validateMobileOrigin(candidate[0]);
    } catch {
      /* Ignore other log URLs. */
    }
  }
  return null;
}
export function validateMobileOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Expected an HTTPS Quick Tunnel origin.');
  return url.origin;
}
export function mobileOverride(folder) {
  return `services:
  db:
    restart: 'no'
  api:
    restart: 'no'
  web:
    restart: 'no'
    ports: !reset []
    volumes:
      - type: bind
        source: ${JSON.stringify(path.join(folder, 'Caddyfile').replaceAll('\\', '/'))}
        target: /etc/caddy/Caddyfile
        read_only: true
  tunnel:
    image: ${tunnelImage}
    restart: 'no'
    command: ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://web:80']
    networks:
      - edge
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    logging:
      driver: local
      options:
        max-size: '5m'
        max-file: '2'
`;
}

const allFirebase = [...FIREBASE_SERVER_KEYS, ...FIREBASE_WEB_KEYS];
const select = (values, keys) => Object.fromEntries(keys.map((key) => [key, values[key]]));
function validatedFirebase(value) {
  const current = validateFirebaseEnvironment(value.server, value.web);
  if (current.projectId !== value.projectId) throw new Error('Firebase project does not match.');
  return current;
}
export function firebaseFingerprint(value) {
  const current = validatedFirebase(value);
  return createHash('sha256').update(JSON.stringify(current)).digest('hex');
}

/** Recover the previously approved pair for rollback without depending on replacement input files. */
export function mobileApprovedFirebase(content, metadata) {
  if (!metadata) return null;
  try {
    const values = parse(content);
    const current = validateFirebaseEnvironment(
      select(values, FIREBASE_SERVER_KEYS),
      select(values, FIREBASE_WEB_KEYS),
    );
    if (
      metadata.projectId !== current.projectId ||
      metadata.fingerprint !== firebaseFingerprint(current)
    )
      throw new Error();
    return current;
  } catch {
    throw new Error(
      'Approved mobile Firebase configuration changed. No public startup was allowed.',
    );
  }
}

/** Replace only Firebase entries; retain existing DB, JWT, hostname and unrelated settings verbatim. */
export function mobileFirebaseEnvironment(content, value) {
  const current = validatedFirebase(value);
  const values = { ...current.server, ...current.web };
  const remaining = new Set(allFirebase);
  // Generated mobile files use one physical line per entry, including escaped PEM newlines.
  const result = content.replace(/^([A-Z_]+)=[^\r\n]*(\r?)$/gm, (line, key, ending) => {
    if (!allFirebase.includes(key)) return line;
    if (!remaining.delete(key)) throw new Error('Duplicate mobile Firebase environment entry.');
    return key + '=' + JSON.stringify(values[key]) + ending;
  });
  if (remaining.size) throw new Error('Incomplete mobile Firebase environment.');
  const parsed = parse(result);
  if (allFirebase.some((key) => parsed[key] !== values[key]))
    throw new Error('Mobile Firebase environment could not be serialized.');
  return result;
}

/** Dedicated mobile values take precedence over the operator's shell configuration. */
export function mobileProcessEnvironment(content, inherited = process.env) {
  return { ...inherited, ...parse(content) };
}

/** Inspect Compose's effective model without printing private environment values. */
export function validateMobileComposeConfig(
  config,
  content,
  project,
  approvedFirebase = null,
  transport = null,
) {
  const invalid = () =>
    new Error('Mobile preview configuration is not isolated. No public startup was allowed.');
  try {
    validateMobileProject(project);
    const approved = approvedFirebase ? validatedFirebase(approvedFirebase) : null;
    const expectedFirebase = approved
      ? { ...approved.server, ...approved.web }
      : Object.fromEntries(allFirebase.map((key) => [key, '']));
    const expected = parse(content);
    const target = new URL(expected.DATABASE_URL);
    const services = config.services;
    const approvedTransport = transport ? validateFunnelTransport(transport) : null;
    if (approvedTransport) validateFunnelComposeServices(services, approvedTransport);
    else if (
      Object.keys(services).some(
        (name) => !['db', 'migrate', 'api', 'web', 'tunnel'].includes(name),
      ) ||
      Object.values(services).some((service) => service.ports?.length)
    )
      throw invalid();
    if (
      config.name !== project ||
      target.protocol !== 'postgresql:' ||
      target.hostname !== 'db' ||
      target.port !== '5432' ||
      target.pathname !== '/kidquest_mobile' ||
      decodeURIComponent(target.username) !== 'kidquest_mobile' ||
      decodeURIComponent(target.password) !== expected.POSTGRES_PASSWORD ||
      expected.POSTGRES_USER !== 'kidquest_mobile' ||
      expected.POSTGRES_DB !== 'kidquest_mobile' ||
      !expected.POSTGRES_PASSWORD ||
      !expected.JWT_SECRET ||
      !expected.KIDQUEST_DOMAIN ||
      (approvedTransport && expected.KIDQUEST_DOMAIN !== approvedTransport.hostname) ||
      !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(expected.KIDQUEST_IMAGE_TAG || '') ||
      [...content.matchAll(/^KIDQUEST_IMAGE_TAG=[^\r\n]*\r?$/gm)].length !== 1 ||
      services.api.image !== 'kidquest-api:' + expected.KIDQUEST_IMAGE_TAG ||
      services.migrate.image !== 'kidquest-migrate:' + expected.KIDQUEST_IMAGE_TAG ||
      services.web.image !== 'kidquest-web:' + expected.KIDQUEST_IMAGE_TAG ||
      services.api.environment.DATABASE_URL !== expected.DATABASE_URL ||
      services.migrate.environment.DATABASE_URL !== expected.DATABASE_URL ||
      services.db.environment.POSTGRES_USER !== expected.POSTGRES_USER ||
      services.db.environment.POSTGRES_DB !== expected.POSTGRES_DB ||
      services.db.environment.POSTGRES_PASSWORD !== expected.POSTGRES_PASSWORD ||
      services.api.environment.JWT_SECRET !== expected.JWT_SECRET ||
      services.api.environment.NODE_ENV !== 'production' ||
      services.api.environment.FRONTEND_URL !== `https://${expected.KIDQUEST_DOMAIN}` ||
      services.web.environment.KIDQUEST_DOMAIN !== expected.KIDQUEST_DOMAIN ||
      allFirebase.some((key) => expected[key] !== expectedFirebase[key]) ||
      FIREBASE_SERVER_KEYS.some((key) => services.api.environment[key] !== expectedFirebase[key]) ||
      FIREBASE_WEB_KEYS.some((key) => services.web.build.args[key] !== expectedFirebase[key]) ||
      Object.entries(services).some(([name, service]) =>
        Object.keys(service.build?.args || {}).some(
          (key) => name !== 'web' || !FIREBASE_WEB_KEYS.includes(key),
        ),
      ) ||
      Object.values(services).some((service) => service.build?.secrets?.length)
    )
      throw invalid();
  } catch {
    // URL/parser failures can contain credentials; never propagate the model or parser input.
    throw invalid();
  }
}
