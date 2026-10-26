import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const photoName = /^[0-9a-f-]{36}\.webp$/;
class BackupError extends Error {}
const usage = `KidQuest manual backup (PostgreSQL + private photos)

Local (stop all API/worker processes first):
  node -- scripts/backup.mjs --writes-paused --pg-bin "C:\\Program Files\\PostgreSQL\\17\\bin"

Production Compose (stop api first; db must remain running):
  node -- scripts/backup.mjs --mode compose --env-file .env.production --compose-file docker-compose.prod.yml --writes-paused

Verify an existing completed backup without connecting to PostgreSQL:
  node -- scripts/backup.mjs --verify .local/backups/<backup-directory>

Options:
  --mode local|compose       Default: local
  --env-file PATH            Default: .env (local), .env.production (compose)
  --database-env NAME        Local URL environment variable; default DATABASE_URL
  --pg-bin DIRECTORY         Local PostgreSQL client binaries; otherwise PATH
  --storage DIRECTORY        Local photo directory; otherwise STORAGE_PATH or ./storage
  --output DIRECTORY         Default: .local/backups; each backup gets a NEW directory
  --compose-file PATH        Default: docker-compose.prod.yml
  --writes-paused            Required acknowledgement that all application writes are stopped
  --allow-empty-photos       Local only: permit a missing photo directory for a database with no photos
  --verify DIRECTORY         Check completion marker, SHA256, sizes, file names and unexpected files
  --help                    Show this help

No database URL or password is passed on process command lines. This tool does not restore or delete backups.
`;

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
async function command(
  executable,
  args,
  { env = process.env, input, output, capture = false, label = path.basename(executable) } = {},
) {
  const source = input ? await open(input, 'r') : null;
  const destination = output ? await open(output, 'wx', 0o600) : null;
  try {
    const text = await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: projectRoot,
        env,
        shell: false,
        windowsHide: true,
        stdio: [source?.fd ?? 'ignore', destination?.fd ?? (capture ? 'pipe' : 'ignore'), 'pipe'],
      });
      let stdout = '';
      child.stdout?.on('data', (chunk) => {
        if (stdout.length < 65_536) stdout += String(chunk);
      });
      // Do not echo tool diagnostics: PostgreSQL/Compose messages can contain private configuration.
      child.stderr?.resume();
      child.once('error', () =>
        reject(
          new BackupError(
            `Не вдалося запустити ${label}. Перевірте встановлення, PATH або --pg-bin.`,
          ),
        ),
      );
      child.once('close', (code) =>
        code === 0
          ? resolve(stdout)
          : reject(
              new BackupError(
                `${label} завершився з кодом ${code ?? 'unknown'}. Деталі приховано, щоб не розкрити конфігурацію. Незавершена копія не придатна для відновлення.`,
              ),
            ),
      );
    });
    if (destination) await destination.sync();
    return text;
  } finally {
    await source?.close();
    await destination?.close();
  }
}
async function digest(filename) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}
async function filesIn(directory, prefix = '') {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new BackupError('Символічні посилання не дозволені у копії.');
    if (entry.isDirectory()) files.push(...(await filesIn(filename, relative)));
    else if (entry.isFile()) files.push(relative);
    else throw new BackupError('У каталозі копії є непідтримуваний тип файлу.');
  }
  return files.sort();
}
async function checkPhotos(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new BackupError('Каталог фото має бути звичайним каталогом, без посилань.');
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || !photoName.test(entry.name))) {
    throw new BackupError(
      'У каталозі фото є невідомі файли або посилання. Очікуються лише приватні UUID.webp KidQuest; перевірте STORAGE_PATH.',
    );
  }
  return entries.map((entry) => entry.name).sort();
}
async function verifyBackup(directory) {
  const root = path.resolve(projectRoot, directory);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new BackupError('Оберіть звичайний каталог готової копії.');
  const files = await filesIn(root);
  if (files.includes('.incomplete') || !files.includes('manifest.json'))
    throw new BackupError('Копію не завершено: потрібен manifest.json без .incomplete.');
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (
    manifest.formatVersion !== 1 ||
    manifest.databaseFormat !== 'pg_dump-custom' ||
    !Array.isArray(manifest.files)
  )
    throw new BackupError('Непідтримуваний формат manifest.json.');
  const recorded = [];
  for (const file of manifest.files) {
    if (
      typeof file.path !== 'string' ||
      (file.path !== 'database.dump' && !/^photos\/[0-9a-f-]{36}\.webp$/.test(file.path)) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    )
      throw new BackupError('Некоректний запис файлу в manifest.json.');
    const filename = path.resolve(root, ...file.path.split('/'));
    if (!inside(root, filename)) throw new BackupError('Шлях файлу виходить за межі копії.');
    const actual = await digest(filename);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
      throw new BackupError('Перевірка SHA256 або розміру не пройшла. Не відновлюйте цю копію.');
    recorded.push(file.path);
  }
  if (
    !recorded.includes('database.dump') ||
    new Set(recorded).size !== recorded.length ||
    JSON.stringify(recorded.sort()) !==
      JSON.stringify(files.filter((file) => file !== 'manifest.json').sort())
  )
    throw new BackupError('Копія містить відсутні, дубльовані або неописані файли.');
  await checkPhotos(path.join(root, 'photos'));
  const archive = await open(path.join(root, 'database.dump'), 'r');
  try {
    const signature = Buffer.alloc(5);
    await archive.read(signature, 0, 5, 0);
    if (signature.toString('ascii') !== 'PGDMP')
      throw new BackupError('database.dump не є custom archive PostgreSQL.');
  } finally {
    await archive.close();
  }
  return {
    directory: root,
    files: recorded.length,
    bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
  };
}
function databaseEnvironment(connectionUrl) {
  let url;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new BackupError('Некоректна PostgreSQL URL у вибраній змінній середовища.');
  }
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    throw new BackupError('Потрібна PostgreSQL URL із сервером і назвою бази.');
  const env = {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGAPPNAME: 'kidquest-manual-backup',
    PGCONNECT_TIMEOUT: '10',
  };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const libpqOptions = {
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    target_session_attrs: 'PGTARGETSESSIONATTRS',
  };
  for (const [option, variable] of Object.entries(libpqOptions))
    if (url.searchParams.has(option)) env[variable] = url.searchParams.get(option);
  // Prisma-only schema/pool options do not belong in libpq's connection options. The whole DB is dumped.
  return env;
}
async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean' },
      mode: { type: 'string' },
      'env-file': { type: 'string' },
      'database-env': { type: 'string' },
      'pg-bin': { type: 'string' },
      storage: { type: 'string' },
      output: { type: 'string' },
      'compose-file': { type: 'string' },
      'writes-paused': { type: 'boolean' },
      'allow-empty-photos': { type: 'boolean' },
      verify: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (values.verify) {
    console.log(`Перевірку копії пройдено: ${JSON.stringify(await verifyBackup(values.verify))}`);
    return;
  }
  if (!values['writes-paused'])
    throw new BackupError(
      'Спочатку зупиніть усі API/worker процеси, залишивши PostgreSQL увімкненим, і передайте --writes-paused.',
    );
  const mode = values.mode || 'local';
  if (!['local', 'compose'].includes(mode))
    throw new BackupError('--mode має бути local або compose.');
  if (
    mode === 'compose' &&
    (values.storage || values['pg-bin'] || values['database-env'] || values['allow-empty-photos'])
  )
    throw new BackupError(
      'Compose використовує власні db і api:/app/storage; локальні параметри тут не підтримуються.',
    );
  const envFile = path.resolve(
    projectRoot,
    values['env-file'] || (mode === 'compose' ? '.env.production' : '.env'),
  );
  let configuration = {};
  try {
    configuration = parse(await readFile(envFile));
  } catch (error) {
    if (error.code !== 'ENOENT' || values['env-file'] || mode === 'compose')
      throw new BackupError('Не вдалося прочитати вибраний env-файл.');
  }
  const environment = { ...configuration, ...process.env };
  const outputBase = path.resolve(projectRoot, values.output || '.local/backups');
  let storage;
  let names = [];
  let pgEnv;
  let pgDump;
  let pgRestore;
  let compose;
  if (mode === 'local') {
    const variable = values['database-env'] || 'DATABASE_URL';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable) || !environment[variable])
      throw new BackupError(
        'Задана змінна PostgreSQL URL відсутня. Перевірте --database-env та env-файл.',
      );
    pgEnv = databaseEnvironment(environment[variable]);
    storage = path.resolve(projectRoot, values.storage || environment.STORAGE_PATH || './storage');
    try {
      names = await checkPhotos(storage);
      storage = await realpath(storage);
    } catch (error) {
      if (error.code !== 'ENOENT' || !values['allow-empty-photos']) throw error;
      storage = null;
    }
    const executable = (name) =>
      values['pg-bin']
        ? path.join(
            path.resolve(projectRoot, values['pg-bin']),
            `${name}${process.platform === 'win32' ? '.exe' : ''}`,
          )
        : name;
    pgDump = executable('pg_dump');
    pgRestore = executable('pg_restore');
    if (storage && inside(storage, outputBase))
      throw new BackupError('Каталог резервних копій не може бути всередині каталогу фото.');
  } else {
    compose = [
      'compose',
      '--env-file',
      envFile,
      '-f',
      path.resolve(projectRoot, values['compose-file'] || 'docker-compose.prod.yml'),
    ];
    const status = await command('docker', [...compose, 'ps', '--all', '--format', 'json', 'api'], {
      capture: true,
      label: 'docker compose ps',
    });
    let containers;
    try {
      const result = status.trim();
      containers = result.startsWith('[')
        ? JSON.parse(result)
        : result
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    } catch {
      throw new BackupError('Не вдалося перевірити стан контейнера api. Копію не розпочато.');
    }
    if (
      !Array.isArray(containers) ||
      containers.length === 0 ||
      containers.some((container) => container.State !== 'exited')
    )
      throw new BackupError(
        'Потрібен наявний зупинений (exited) контейнер api. Зупиніть api перед узгодженою копією БД та фото.',
      );
  }
  const toolVersion =
    mode === 'local'
      ? (
          await command(pgDump, ['--version'], {
            capture: true,
            env: pgEnv,
            label: 'pg_dump --version',
          })
        ).trim()
      : (
          await command('docker', [...compose, 'exec', '-T', 'db', 'pg_dump', '--version'], {
            capture: true,
            label: 'pg_dump --version',
          })
        ).trim();
  await mkdir(outputBase, { recursive: true, mode: 0o700 });
  const actualOutputBase = await realpath(outputBase);
  if (storage && inside(storage, actualOutputBase))
    throw new BackupError('Каталог резервних копій не може бути всередині каталогу фото.');
  const createdAt = new Date().toISOString();
  const identifier = `${createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID().slice(0, 8)}`;
  const destination = path.join(actualOutputBase, identifier);
  await mkdir(destination, { mode: 0o700 });
  const incomplete = path.join(destination, '.incomplete');
  await writeFile(incomplete, 'Backup not completed. Do not restore.\n', {
    flag: 'wx',
    mode: 0o600,
  });
  const archive = path.join(destination, 'database.dump');
  const photos = path.join(destination, 'photos');
  await mkdir(photos, { mode: 0o700 });
  if (mode === 'local') {
    await command(
      pgDump,
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        '--lock-wait-timeout=10s',
      ],
      { env: pgEnv, output: archive, label: 'pg_dump' },
    );
    await command(pgRestore, ['--list', archive], { env: pgEnv, label: 'pg_restore --list' });
    for (const name of names)
      await copyFile(path.join(storage, name), path.join(photos, name), constants.COPYFILE_EXCL);
  } else {
    await command(
      'docker',
      [
        ...compose,
        'exec',
        '-T',
        'db',
        'sh',
        '-c',
        'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --format=custom --no-owner --no-privileges --no-password --lock-wait-timeout=10s -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
      ],
      { output: archive, label: 'docker pg_dump' },
    );
    await command('docker', [...compose, 'exec', '-T', 'db', 'pg_restore', '--list'], {
      input: archive,
      label: 'docker pg_restore --list',
    });
    await command('docker', [...compose, 'cp', 'api:/app/storage/.', photos], {
      label: 'docker compose cp photos',
    });
    names = await checkPhotos(photos);
  }
  const files = [];
  for (const relative of ['database.dump', ...names.map((name) => `photos/${name}`)])
    files.push({
      path: relative,
      ...(await digest(path.join(destination, ...relative.split('/')))),
    });
  await writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        databaseFormat: 'pg_dump-custom',
        mode,
        createdAt,
        completedAt: new Date().toISOString(),
        toolVersion,
        photoCount: names.length,
        files,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  await unlink(incomplete);
  console.log(
    `Резервну копію створено та перевірено: ${JSON.stringify(await verifyBackup(destination))}`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof BackupError
      ? error.message
      : 'Резервну копію не завершено. Перевірте параметри, доступ до файлів і вільне місце; незавершений каталог збережено для діагностики.',
  );
  process.exitCode = 1;
});
