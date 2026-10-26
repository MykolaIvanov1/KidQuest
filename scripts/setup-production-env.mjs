import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const { values } = parseArgs({
  options: { domain: { type: 'string' }, email: { type: 'string' } },
});
if (!values.domain || !values.email)
  throw new Error(
    'Use pnpm setup:production --domain kidquest.your-domain.tld --email owner@your-domain.tld',
  );
const domain = values.domain.toLowerCase();
if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
  throw new Error('Provide a domain name without protocol, port or path.');
if (!/^[^\s@=]+@[^\s@=]+\.[^\s@=]+$/.test(values.email))
  throw new Error('Provide an email address for certificate notices.');
const password = randomBytes(32).toString('hex');
const template = await readFile(new URL('../.env.production.example', import.meta.url), 'utf8');
const result = template
  .replace('KIDQUEST_DOMAIN=kidquest.example.com', `KIDQUEST_DOMAIN=${domain}`)
  .replace('CADDY_EMAIL=owner@example.com', `CADDY_EMAIL=${values.email}`)
  .replaceAll('REPLACE_WITH_PRODUCTION_PASSWORD', password)
  .replace('REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES', randomBytes(48).toString('hex'));
try {
  await writeFile(new URL('../.env.production', import.meta.url), result, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log('Created ignored .env.production with generated secrets. No services were started.');
} catch (error) {
  if (error.code === 'EEXIST') throw new Error('.env.production already exists and was preserved.');
  throw error;
}
