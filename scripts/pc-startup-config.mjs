import { createHash } from 'node:crypto';
import path from 'node:path';

const invalid = () => new Error('Invalid Windows startup configuration.');
const xmlEscape = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character],
  );
function windowsPath(value) {
  if (
    typeof value !== 'string' ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32) ||
    /[<>"|?*]/.test(value)
  )
    throw invalid();
  const normalized = path.win32.normalize(value);
  if (!/^[A-Za-z]:\\/.test(normalized) || normalized.includes(':', 2)) throw invalid();
  return normalized.replace(/\\+$/, '');
}
export function parseWindowsSid(output) {
  const matches = String(output).match(/\bS-1-(?:\d+-)*\d+\b/g) || [];
  if (matches.length !== 1) throw invalid();
  return matches[0];
}
const psLiteral = (value) => "'" + value.replaceAll("'", "''") + "'";
export function startupDefinition({ root, nodePath, windowsDirectory, userSid }) {
  const workspace = windowsPath(root);
  const node = windowsPath(nodePath);
  const windows = windowsPath(windowsDirectory);
  if (
    path.win32.basename(node).toLowerCase() !== 'node.exe' ||
    !/^S-1-(?:5-21-\d+-\d+-\d+-\d+|12-1-\d+-\d+-\d+-\d+)$/.test(userSid)
  )
    throw invalid();
  const script = path.win32.join(workspace, 'scripts', 'pc-startup.mjs');
  const taskName =
    'KidQuest-' + createHash('sha256').update(workspace.toLowerCase()).digest('hex').slice(0, 12);
  const command = path.win32.join(
    windows,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  // Inline commands work without changing PowerShell's script execution policy.
  const argumentsText =
    '-NoProfile -NonInteractive -WindowStyle Hidden -Command "& ' +
    psLiteral(node) +
    ' ' +
    psLiteral(script) +
    ' run"';
  const principal = { userSid, logonType: 'InteractiveToken', runLevel: 'LeastPrivilege' };
  const expected = {
    taskName,
    command,
    arguments: argumentsText,
    workingDirectory: workspace,
    principal,
  };
  const escape = xmlEscape;
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Start this KidQuest checkout after the current user signs in. No passwords are stored.</Description>
    <URI>\\${taskName}</URI>
  </RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${escape(userSid)}</UserId><Delay>PT30S</Delay></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${escape(userSid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled><Hidden>true</Hidden><WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec>
    <Command>${escape(command)}</Command><Arguments>${escape(argumentsText)}</Arguments>
    <WorkingDirectory>${escape(workspace)}</WorkingDirectory>
  </Exec></Actions>
</Task>
`;
  return { ...expected, xml };
}
export function ownsStartupTask(actual, expected) {
  try {
    return (
      actual?.exists === true &&
      actual.actions?.length === 1 &&
      actual.actions[0].type === 'Exec' &&
      windowsPath(actual.actions[0].command).toLowerCase() === expected.command.toLowerCase() &&
      actual.actions[0].arguments === expected.arguments &&
      windowsPath(actual.actions[0].workingDirectory).toLowerCase() ===
        expected.workingDirectory.toLowerCase() &&
      actual.principal?.userSid === expected.principal.userSid &&
      actual.principal?.logonType === 'InteractiveToken' &&
      actual.principal?.runLevel === 'LeastPrivilege'
    );
  } catch {
    return false;
  }
}
