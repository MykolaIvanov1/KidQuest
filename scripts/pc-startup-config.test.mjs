import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownsStartupTask, parseWindowsSid, startupDefinition } from './pc-startup-config.mjs';

const input = {
  root: 'C:\\Users\\family\\Desktop\\KidQuest',
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  windowsDirectory: 'C:\\Windows',
  userSid: 'S-1-5-21-100-200-300-1001',
};
const metadata = (expected) => ({
  exists: true,
  actions: [
    {
      type: 'Exec',
      command: expected.command,
      arguments: expected.arguments,
      workingDirectory: expected.workingDirectory,
    },
  ],
  principal: { ...expected.principal },
});

test('Windows startup identity is stable for equivalent checkout paths and distinct for other checkouts', () => {
  const actual = startupDefinition(input);
  assert.match(actual.taskName, /^KidQuest-[a-f0-9]{12}$/);
  assert.equal(
    startupDefinition({ ...input, root: 'c:/users/family/Desktop/./KidQuest/' }).taskName,
    actual.taskName,
  );
  assert.notEqual(
    startupDefinition({ ...input, root: 'C:\\KidQuest-other' }).taskName,
    actual.taskName,
  );
  assert.notEqual(
    startupDefinition({ ...input, root: 'C:\\KidQuest-other' }).workingDirectory,
    actual.workingDirectory,
  );
});

test('Windows task starts only the interactive current user with least privilege and no saved password', () => {
  const actual = startupDefinition(input);
  assert.match(actual.xml, /<LogonTrigger>/);
  assert.match(actual.xml, /<UserId>S-1-5-21-100-200-300-1001<\/UserId>/);
  assert.match(actual.xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(actual.xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(actual.xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(actual.xml, /<Hidden>true<\/Hidden>/);
  assert.match(actual.xml, /<WakeToRun>false<\/WakeToRun>/);
  assert.doesNotMatch(
    actual.xml,
    /<BootTrigger>|<Password>|HighestAvailable|<UserId>SYSTEM<|S-1-5-18|ExecutionPolicy|Bypass/i,
  );
  assert.ok(actual.arguments.endsWith('\' run"'));
  assert.match(actual.arguments, /-WindowStyle Hidden/);
  assert.ok(actual.command.endsWith('System32\\WindowsPowerShell\\v1.0\\powershell.exe'));
});

test('Windows task preserves Unicode and safely quotes spaces, XML characters and PowerShell metacharacters', () => {
  const root = "C:\\Users\\family\\KidQuest & мама's $folder; test`";
  const actual = startupDefinition({ ...input, root });
  assert.equal(actual.workingDirectory, root);
  assert.match(actual.xml, /KidQuest &amp; мама&apos;s \$folder; test`/);
  assert.ok(actual.arguments.includes("мама''s $folder; test`\\scripts\\pc-startup.mjs' run"));
  assert.doesNotMatch(actual.xml, /<WorkingDirectory>[^<]* & [^<]*<\/WorkingDirectory>/);
});

test('Windows startup refuses relative, UNC, injected and non-node executable configuration without echoing it', () => {
  for (const changed of [
    { root: '..\\private-secret' },
    { root: '\\\\remote\\share\\private-secret' },
    { root: 'C:\\private-secret\nInvoke-Expression' },
    { root: 'C:\\private-secret" -Command bad' },
    { root: 'C:\\private-secret:stream' },
    { nodePath: 'C:\\private-secret\\cmd.exe' },
    { userSid: 'S-1-5-private-secret' },
    { userSid: 'S-1-5-18' },
    { userSid: 'S-1-5-21-100;private-secret' },
  ]) {
    assert.throws(() => startupDefinition({ ...input, ...changed }), {
      message: 'Invalid Windows startup configuration.',
    });
  }
});

test('Windows account SID parser accepts one identity and rejects ambiguous or missing account output', () => {
  assert.equal(parseWindowsSid('"FAMILY\\User","' + input.userSid + '"\r\n'), input.userSid);
  for (const value of ['private-secret', 'S-1-5-21-1 S-1-5-21-2'])
    assert.throws(() => parseWindowsSid(value), {
      message: 'Invalid Windows startup configuration.',
    });
});

test('Windows startup ownership refuses other users, privilege expansion, other commands and extra actions', () => {
  const expected = startupDefinition(input);
  assert.equal(ownsStartupTask(metadata(expected), expected), true);
  assert.equal(ownsStartupTask({ exists: false }, expected), false);
  const changes = [
    (actual) => (actual.actions[0].command = 'C:\\other\\powershell.exe'),
    (actual) => (actual.actions[0].arguments += ';other-command'),
    (actual) => (actual.actions[0].workingDirectory = 'C:\\another-checkout'),
    (actual) => (actual.actions[0].type = 'ComHandler'),
    (actual) => actual.actions.push({ ...actual.actions[0] }),
    (actual) => (actual.principal.userSid = 'S-1-5-21-100-200-300-1002'),
    (actual) => (actual.principal.runLevel = 'HighestAvailable'),
    (actual) => (actual.principal.logonType = 'Password'),
  ];
  for (const change of changes) {
    const actual = metadata(expected);
    change(actual);
    assert.equal(ownsStartupTask(actual, expected), false);
  }
});
