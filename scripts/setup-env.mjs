import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const password = randomBytes(24).toString('hex');
const content = template
  .replaceAll('REPLACE_WITH_LOCAL_PASSWORD', password)
  .replace('REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES', randomBytes(48).toString('hex'))
  .replace('REPLACE_WITH_ANOTHER_32_RANDOM_BYTES', randomBytes(48).toString('hex'));
try {
  await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx' });
  console.log('Створено .env із випадковими локальними секретами.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env уже існує; наявну конфігурацію збережено.');
}
