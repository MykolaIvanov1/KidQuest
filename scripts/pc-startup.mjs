import { spawn } from 'node:child_process';
import { access, appendFile, mkdir, stat, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ownsStartupTask, parseWindowsSid, startupDefinition } from './pc-startup-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const folder = path.join(root, '.local/pc-host');
const taskFile = path.join(folder, 'startup-task.xml');
const mode = process.argv[2];
const usage =
  'Use pc-startup.mjs prepare, install, status, remove or run. Startup occurs after Windows sign-in.';
function execute(command, args, { capture = true, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'],
    });
    let output = '';
    let timedOut = false;
    child.stdout?.on('data', (chunk) => {
      if (output.length < 500_000) output += chunk.toString('utf8');
    });
    const timer = timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeout)
      : null;
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Required Windows startup executable is unavailable.'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, output });
    });
  });
}
async function writeLog(event) {
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'startup.log');
  const size = await stat(file)
    .then((value) => value.size)
    .catch(() => 0);
  if (size > 256_000) await rename(file, path.join(folder, 'startup.previous.log'));
  await appendFile(file, new Date().toISOString() + ' ' + event + '\n', { mode: 0o600 });
}
async function definition() {
  const whoami = await execute(
    path.join(process.env.SystemRoot || 'C:/Windows', 'System32/whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
  );
  if (whoami.code !== 0) throw new Error('Could not identify the current Windows account.');
  return startupDefinition({
    root,
    nodePath: process.execPath,
    windowsDirectory: process.env.SystemRoot || 'C:/Windows',
    userSid: parseWindowsSid(whoami.output),
  });
}
async function queryTask(expected) {
  // Task names contain only our fixed prefix and a checkout hash. All inspected fields are ownership metadata.
  const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
try { $task = Get-ScheduledTask -TaskName '${expected.taskName}' -TaskPath '\\' -ErrorAction Stop }
catch {
  if ($_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { @{exists=$false} | ConvertTo-Json -Compress; exit 0 }
  throw
}
if ($null -eq $task) { throw 'Task inspection returned no result.' }
[xml]$xml = Export-ScheduledTask -TaskName '${expected.taskName}' -TaskPath '\\'
$actions = @($xml.Task.Actions.ChildNodes | Where-Object { $_.NodeType -eq [System.Xml.XmlNodeType]::Element } | ForEach-Object { @{type=$_.LocalName;command=[string]$_.Command;arguments=[string]$_.Arguments;workingDirectory=[string]$_.WorkingDirectory} })
$level = [string]$xml.Task.Principals.Principal.RunLevel
# Task Scheduler omits the default LeastPrivilege element when exporting a registered task.
if ([string]::IsNullOrEmpty($level) -and [int]$task.Principal.RunLevel -eq 0) { $level = 'LeastPrivilege' }
@{exists=$true;state=[string]$task.State;actions=$actions;principal=@{userSid=[string]$xml.Task.Principals.Principal.UserId;logonType=[string]$xml.Task.Principals.Principal.LogonType;runLevel=$level}} | ConvertTo-Json -Depth 6 -Compress`;
  const result = await execute(expected.command, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  if (result.code !== 0)
    throw new Error('Could not inspect Windows Task Scheduler. Existing tasks were preserved.');
  try {
    return JSON.parse(result.output.replace(/^\uFEFF/, '').trim());
  } catch {
    throw new Error('Could not inspect Windows Task Scheduler. Existing tasks were preserved.');
  }
}
async function prepare(expected) {
  await mkdir(folder, { recursive: true });
  await writeFile(
    taskFile,
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(expected.xml, 'utf16le')]),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(folder, 'startup-task.json'),
    JSON.stringify(
      {
        taskName: expected.taskName,
        trigger: 'current-user-sign-in',
        privilege: 'LeastPrivilege',
        command: expected.command,
        arguments: expected.arguments,
        workingDirectory: expected.workingDirectory,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}
async function run() {
  await access(path.join(root, '.local/mobile-preview/state.json'));
  await access(path.join(root, '.local/mobile-preview/mobile.env'));
  await writeLog('STARTING');
  const programFiles = process.env.ProgramFiles || 'C:/Program Files';
  const docker = path.join(programFiles, 'Docker/Docker/resources/bin/docker.exe');
  const desktop = path.join(programFiles, 'Docker/Docker/Docker Desktop.exe');
  let ready =
    (await execute(docker, ['info', '--format', '{{.ServerVersion}}'], { timeout: 10_000 }))
      .code === 0;
  if (!ready) {
    await access(desktop);
    const shell = path.join(
      process.env.SystemRoot || 'C:/Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const literal = "'" + desktop.replaceAll("'", "''") + "'";
    const launched = await execute(shell, [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      'Start-Process -FilePath ' + literal + ' -WindowStyle Hidden',
    ]);
    if (launched.code !== 0) throw new Error('Docker Desktop could not be started.');
    await writeLog('DOCKER_START_REQUESTED');
    const deadline = Date.now() + 10 * 60_000;
    while (!ready && Date.now() < deadline) {
      await delay(5_000);
      ready =
        (await execute(docker, ['info', '--format', '{{.ServerVersion}}'], { timeout: 10_000 }))
          .code === 0;
    }
  }
  if (!ready) throw new Error('Docker did not become ready within ten minutes.');
  await writeLog('DOCKER_READY');
  // The guarded resume command reuses approved configuration/images and never builds or seeds data.
  const resumed = await execute(
    process.execPath,
    [path.join(root, 'scripts/mobile-preview.mjs'), 'resume'],
    { capture: false, timeout: null },
  );
  if (resumed.code !== 0)
    throw new Error('KidQuest resume failed. Run the manual resume command for diagnostics.');
  await writeLog('READY');
  await writeFile(
    path.join(folder, 'last-startup.json'),
    JSON.stringify({ completedAt: new Date().toISOString(), status: 'ready' }, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log('KidQuest resumed. Use mobile:status to view its current address.');
}
try {
  if (
    !['prepare', 'install', 'status', 'remove', 'run'].includes(mode) ||
    process.argv.length !== 3
  )
    throw new Error(usage);
  if (process.platform !== 'win32') throw new Error('This startup helper supports Windows only.');
  if (mode === 'run') await run();
  else {
    const expected = await definition();
    if (mode === 'prepare') {
      await prepare(expected);
      console.log(
        'Prepared .local/pc-host/startup-task.xml and startup-task.json. No Windows task was changed.',
      );
    } else {
      const actual = await queryTask(expected);
      if (actual.exists && !ownsStartupTask(actual, expected))
        throw new Error(
          'The task name belongs to a different command or account. It was preserved.',
        );
      if (mode === 'status')
        console.log(
          actual.exists
            ? 'KidQuest sign-in startup is installed (' + actual.state + ').'
            : 'KidQuest sign-in startup is not installed.',
        );
      else if (mode === 'install') {
        await prepare(expected);
        const installed = await execute(
          path.join(process.env.SystemRoot || 'C:/Windows', 'System32/schtasks.exe'),
          ['/Create', '/TN', expected.taskName, '/XML', taskFile, ...(actual.exists ? ['/F'] : [])],
        );
        if (installed.code !== 0)
          throw new Error(
            'Task installation failed. Run the reviewed install command with Windows permission to create your own scheduled task.',
          );
        if (!ownsStartupTask(await queryTask(expected), expected))
          throw new Error('The installed task could not be verified.');
        console.log(
          'KidQuest will resume after this Windows account signs in. No password was saved; sleep and firewall settings were not changed.',
        );
      } else if (!actual.exists) console.log('KidQuest sign-in startup is already absent.');
      else {
        const removed = await execute(
          path.join(process.env.SystemRoot || 'C:/Windows', 'System32/schtasks.exe'),
          ['/Delete', '/TN', expected.taskName, '/F'],
        );
        if (removed.code !== 0)
          throw new Error('Task removal failed. No application data was changed.');
        if ((await queryTask(expected)).exists)
          throw new Error('Task removal could not be verified.');
        console.log('KidQuest sign-in startup removed. Application data was preserved.');
      }
    }
  }
} catch (error) {
  if (mode === 'run') {
    await writeLog('FAILED').catch(() => undefined);
    await writeFile(
      path.join(folder, 'last-startup.json'),
      JSON.stringify({ completedAt: new Date().toISOString(), status: 'failed' }, null, 2) + '\n',
      { mode: 0o600 },
    ).catch(() => undefined);
  }
  console.error(
    error instanceof Error ? error.message : 'PC startup failed. Private details were not logged.',
  );
  process.exitCode = 1;
}
