$ErrorActionPreference = 'Stop'
# Windows can reuse a PID after a reboot. Only retire a lock whose process
# is absent or was created after that lock; never stop the referenced process.
$previewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previewLockPath = Join-Path $previewRoot '.vinext/dev/lock.json'
if (-not (Test-Path -LiteralPath $previewLockPath)) { exit 0 }
$previewLockText = Get-Content -LiteralPath $previewLockPath -Raw
$previewLock = $previewLockText | ConvertFrom-Json
if (-not $previewLock.pid -or -not $previewLock.startedAt) {
    throw 'Invalid local server lock. Please inspect .vinext/dev/lock.json.'
}
$previewOwner = Get-Process -Id $previewLock.pid -ErrorAction SilentlyContinue
$previewStale = $null -eq $previewOwner
if ($previewOwner) {
    $previewStartedAt = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$previewLock.startedAt)
    $previewStale = $previewOwner.StartTime.ToUniversalTime() -gt $previewStartedAt.UtcDateTime.AddSeconds(1)
}
if ($previewStale -and (Get-Content -LiteralPath $previewLockPath -Raw) -ceq $previewLockText) {
    $previewBackupDir = Join-Path $previewRoot 'work'
    New-Item -ItemType Directory -Path $previewBackupDir -Force | Out-Null
    $previewBackup = Join-Path $previewBackupDir ('stale-dev-lock-' + [guid]::NewGuid().ToString() + '.json')
    Move-Item -LiteralPath $previewLockPath -Destination $previewBackup
    Write-Host 'Recovered an expired local server lock. Other processes were not changed.'
}
