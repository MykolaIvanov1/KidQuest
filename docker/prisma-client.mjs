import { cp, realpath, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const [mode, directory] = process.argv.slice(2);
if (!['export', 'install'].includes(mode) || !directory)
  throw new Error('Use prisma-client.mjs export|install DIRECTORY');
const backend = createRequire(path.resolve('backend/package.json'));
const clientPackage = await realpath(backend.resolve('@prisma/client/package.json'));
const client = createRequire(clientPackage);
const generatedTarget = path.join(
  path.dirname(path.dirname(path.dirname(clientPackage))),
  '.prisma/client',
);
const source =
  mode === 'export'
    ? path.dirname(client.resolve('.prisma/client/package.json'))
    : path.resolve(directory);
const destination = mode === 'export' ? path.resolve(directory) : generatedTarget;
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, force: true });
console.log(`Generated Prisma client ${mode} completed.`);
