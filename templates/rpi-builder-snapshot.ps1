#Requires -Version 5.1
<#
.SYNOPSIS
Back up or restore the dedicated rpi-builder WSL distribution.
.DESCRIPTION
Backup saves the entire Linux builder: installed tools, settings and any builds.
Create your clean baseline after setup, before building projects. Restore replaces
rpi-builder with that baseline, permanently discarding changes since the backup.
Other WSL distributions and Windows export folders are unaffected.

Snapshots live outside WSL, beside this script in the exported bundle by default.
This uses the script folder even when launched from another working directory.
Run as the Windows user who owns rpi-builder. Close its terminals and stop builds
before either action: the script stops only rpi-builder to make a consistent copy.
Backup replaces the selected snapshot only after a successful export.
.EXAMPLE
.\rpi-builder-snapshot.ps1 backup
Save the current builder as the baseline (or replace the previous baseline).
.EXAMPLE
.\rpi-builder-snapshot.ps1 restore
Discard the current builder and restore the saved baseline.
.EXAMPLE
.\rpi-builder-snapshot.ps1 backup -BackupPath D:\Backups\rpi-builder.tar
Use a different snapshot location. Supply the same path when restoring.
.EXAMPLE
.\rpi-builder-snapshot.ps1 restore -WhatIf
Preview the restore without stopping or replacing the distribution.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('backup', 'restore')]
    [string]$Action,

    [string]$BackupPath = (Join-Path $PSScriptRoot 'rpi-builder.tar')
)

# -----------------------------------------------------------------------------
# Windows: fixed target, snapshot paths and reliable error handling
# -----------------------------------------------------------------------------

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$distributionName = 'rpi-builder'
$BackupPath = [IO.Path]::GetFullPath($BackupPath)
$checksumPath = $BackupPath + '.sha256'

# A snapshot must survive unregistering WSL. Reject WSL network filesystem paths.
if ($BackupPath.StartsWith('\\')) { throw 'Use a Windows drive path for the backup, outside WSL.' }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'WSL is not installed.' }

function Invoke-SnapshotWsl {
    param([string[]]$Arguments)
    & wsl.exe @Arguments
    # Windows PowerShell 5.1 requires an explicit native exit-code check.
    if ($LASTEXITCODE -ne 0) {
        throw "WSL snapshot command failed (exit $LASTEXITCODE): $($Arguments -join ' '). The snapshot is kept; inspect the output above before retrying."
    }
}

$installed = @((Invoke-SnapshotWsl -Arguments @('--list', '--quiet')) | ForEach-Object {
    ([string]$_).Replace([string][char]0, '').Trim()
})
$exists = $installed -contains $distributionName

# -----------------------------------------------------------------------------
# Backup: stop the builder and export its complete Linux filesystem
# -----------------------------------------------------------------------------

if ($Action -eq 'backup') {
    if (-not $exists) { throw 'rpi-builder is missing. Run create-rpi-builder.ps1 first.' }
    if (-not $PSCmdlet.ShouldProcess($distributionName, "Stop and back up to $BackupPath (replace this snapshot if present)")) { return }

    $parent = Split-Path -Parent $BackupPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    # Export to a fresh temporary filename so a failed export keeps the baseline.
    $temporary = Join-Path $parent ('.rpi-builder-' + [guid]::NewGuid().ToString('N') + '.tar')
    Invoke-SnapshotWsl -Arguments @('--terminate', $distributionName)
    Write-Host 'Exporting rpi-builder. This can take several minutes...'
    Invoke-SnapshotWsl -Arguments @('--export', $distributionName, $temporary)
    if (-not (Test-Path -LiteralPath $temporary -PathType Leaf) -or (Get-Item -LiteralPath $temporary).Length -eq 0) {
        throw 'WSL did not produce a nonempty snapshot. The previous baseline is kept.'
    }
    $hash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
    Move-Item -LiteralPath $temporary -Destination $BackupPath -Force
    # The checksum detects a damaged or accidentally changed archive before restore.
    Set-Content -LiteralPath $checksumPath -Value $hash -Encoding ASCII
    Write-Host "Backup saved: $BackupPath"
    Write-Host 'The builder is stopped. It will start normally on your next build.'
    return
}

# -----------------------------------------------------------------------------
# Restore: validate the saved snapshot BEFORE removing the current builder
# -----------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw "Snapshot not found: $BackupPath. Run backup first." }
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) { throw "Snapshot checksum not found: $checksumPath. Restore requires a snapshot made by this script." }
$expected = (Get-Content -Raw -LiteralPath $checksumPath).Trim()
if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash -ne $expected) {
    throw 'Snapshot checksum mismatch. The current builder has not been changed.'
}

# Use a fresh dedicated directory for every import. No recursive Windows deletion
# is needed, and a failed import cannot accidentally reuse another distribution.
$installRoot = Join-Path $env:LOCALAPPDATA 'PiCreator\wsl'
$installPath = Join-Path $installRoot ('rpi-builder-' + [guid]::NewGuid().ToString('N'))
if (-not $PSCmdlet.ShouldProcess($distributionName, "PERMANENTLY DISCARD its current Linux files and restore $BackupPath")) { return }

# -----------------------------------------------------------------------------
# Restore: replace only rpi-builder, then select root for local WSL access
# -----------------------------------------------------------------------------

if ($exists) {
    Write-Warning 'Restoring deletes all changes and build outputs inside rpi-builder since the snapshot.'
    Invoke-SnapshotWsl -Arguments @('--unregister', $distributionName)
}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
# WSL import reads the saved tar without consuming it, so restores are repeatable.
# If import fails, the snapshot remains available; run restore again after fixing
# the reported issue (for example insufficient disk space).
Invoke-SnapshotWsl -Arguments @('--import', $distributionName, $installPath, $BackupPath, '--version', '2')
Invoke-SnapshotWsl -Arguments @('--manage', $distributionName, '--set-default-user', 'root')
Write-Host "Restored rpi-builder from: $BackupPath"
Write-Host 'Run build-in-wsl.ps1 to build in the restored environment.'
