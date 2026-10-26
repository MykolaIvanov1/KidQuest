[CmdletBinding()]
param(
  [ValidateSet('local', 'compose')][string]$Mode = 'local',
  [string]$EnvFile,
  [string]$DatabaseEnv,
  [string]$PgBin,
  [string]$Storage,
  [string]$Output,
  [string]$ComposeFile,
  [switch]$WritesPaused,
  [switch]$AllowEmptyPhotos,
  [string]$Verify
)
$ErrorActionPreference = 'Stop'
$backupArgs = @('--', (Join-Path $PSScriptRoot 'backup.mjs'))
if ($Verify) {
  $backupArgs += @('--verify', $Verify)
} else {
  $backupArgs += @('--mode', $Mode)
  $options = @{ 'env-file' = $EnvFile; 'database-env' = $DatabaseEnv; 'pg-bin' = $PgBin; 'storage' = $Storage; 'output' = $Output; 'compose-file' = $ComposeFile }
  foreach ($option in $options.GetEnumerator()) {
    if ($option.Value) { $backupArgs += @('--' + $option.Key, $option.Value) }
  }
  if ($WritesPaused) { $backupArgs += '--writes-paused' }
  if ($AllowEmptyPhotos) { $backupArgs += '--allow-empty-photos' }
}
& node @backupArgs
exit $LASTEXITCODE
