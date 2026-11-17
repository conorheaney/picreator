#Requires -Version 5.1
<#
.SYNOPSIS
Copy this exported bundle into rpi-builder and build its Raspberry Pi image.
.DESCRIPTION
Run from an extracted bundle. Uses the script's folder, regardless of the current
working directory. Starts the existing rpi-builder as root without Ubuntu's
interactive first-run wizard. Never recreates the distribution or installs tools.
Copies manifest-listed source files into a NEW private Linux directory per run;
previous source copies and image outputs are preserved. Shows the Linux build
directory and streams preflight/build output, also saved there as build.log.
.EXAMPLE
.\build-in-wsl.ps1
Copy sources, check prerequisites and configuration, then build the image.
.EXAMPLE
.\build-in-wsl.ps1 -CheckOnly
Copy sources and run preflight only, without building an image.
.EXAMPLE
.\build-in-wsl.ps1 -WhatIf
Show the planned operation without launching WSL or copying files.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$CheckOnly)


# -----------------------------------------------------------------------------
# Windows: select this bundle and stop on errors
# -----------------------------------------------------------------------------

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$distributionName = 'rpi-builder'
$bundlePath = $PSScriptRoot


# -----------------------------------------------------------------------------
# Windows: verify source files before running anything
# -----------------------------------------------------------------------------

# Read only this bundle's metadata. Reject missing files, path traversal and
# checksum mismatches BEFORE starting WSL or executing any copied scripts.
$manifest = Get-Content -Raw -LiteralPath (Join-Path $bundlePath 'manifest.json') | ConvertFrom-Json
$project = Get-Content -Raw -LiteralPath (Join-Path $bundlePath 'project.json') | ConvertFrom-Json
$slug = [string]$project.project.slug
if ($slug -notmatch '^[a-z0-9][a-z0-9-]{0,62}$') { throw 'Invalid project slug in project.json.' }
$sourceNames = @($manifest.files.PSObject.Properties | ForEach-Object {
    $name = $_.Name
    if ($name -match '[\x00-\x1f\\:]' -or $name.StartsWith('/') -or ($name.Split('/') | Where-Object { $_ -in @('', '.', '..') })) {
        throw "Unsafe manifest path: $name"
    }
    $filePath = Join-Path $bundlePath $name
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "Missing bundle file: $name" }
    if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -ne $_.Value) { throw "Bundle checksum mismatch: $name. Export a fresh bundle." }
    $name
})
foreach ($required in @('project.json','config.yaml','build.sh','build-in-wsl.ps1')) {
    if ($sourceNames -notcontains $required) { throw "Bundle manifest is missing $required." }
}
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'WSL is not installed. See README.md.' }
$action = if ($CheckOnly) { 'Copy bundle into a new Linux folder and run preflight' } else { 'Copy bundle into a new Linux folder, run preflight and build the Pi image' }
if (-not $PSCmdlet.ShouldProcess($distributionName, $action)) { return }


# -----------------------------------------------------------------------------
# Windows: check the existing WSL builder
# -----------------------------------------------------------------------------

# Check exact names; never silently build in another distribution. Native exit
# codes need explicit checks in Windows PowerShell 5.1.
$installed = @(& wsl.exe --list --quiet | ForEach-Object { ([string]$_).Replace([string][char]0, '').Trim() })
if ($LASTEXITCODE -ne 0) { throw 'Could not list WSL distributions.' }
if ($installed -notcontains $distributionName) { throw 'rpi-builder is missing. Run create-rpi-builder.ps1 first.' }


# -----------------------------------------------------------------------------
# Windows: prepare the Linux commands below
# -----------------------------------------------------------------------------

# Base64 protects Windows paths, spaces and apostrophes across native Windows
# argument parsing and Bash. Only fixed commands enter the shell as code.
function ConvertTo-BuilderBase64([string]$Value) {
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
}
$pathEncoded = ConvertTo-BuilderBase64 $bundlePath
$filesEncoded = ConvertTo-BuilderBase64 (($sourceNames + @('manifest.json')) -join "`n")
$mode = if ($CheckOnly) { 'check' } else { 'build' }
$bootstrap = @'
#!/bin/bash
# Runs as root INSIDE the existing builder. No installation, reset or flashing.

# -----------------------------------------------------------------------------
# Linux: stop on failure and keep the initial source copy private
# -----------------------------------------------------------------------------

# This block runs in WSL as root, not in Windows PowerShell.
set -Eeuo pipefail
# Stage names help diagnose failures without exposing potentially secret command
# arguments. build.sh supplies more specific diagnostics for its own checks.
stage='starting the builder'
trap 'status=$?; echo "WSL launcher failed during $stage (line $LINENO, exit $status)." >&2; exit "$status"' ERR
umask 077
test "$(id -u)" = 0
export RPI_IMAGE_GEN=/root/rpi-image-gen/rpi-image-gen
test -x "$RPI_IMAGE_GEN" || { echo 'rpi-image-gen is missing; run create-rpi-builder.ps1 -SetupOnly.' >&2; exit 1; }

# -----------------------------------------------------------------------------
# Linux: locate the Windows bundle and create a fresh build folder
# -----------------------------------------------------------------------------

# Translate the absolute Windows source path using this distribution's automount
# configuration. Keep Linux sources/build output off the Windows filesystem.
source_windows=$(printf '%s' '__PATH__' | base64 -d)
source_linux=$(wslpath -u "$source_windows")
test -d "$source_linux"
mkdir -p /root/pi-projects
destination=$(mktemp -d '/root/pi-projects/__SLUG__-XXXXXXXX')
echo "Linux build directory: $destination"

# -----------------------------------------------------------------------------
# Linux: copy verified source files and set build permissions
# -----------------------------------------------------------------------------

stage='copying bundle source files'
# Copy only manifest-listed files, excluding unrelated Windows files and previous
# outputs. --parents preserves the layer/keys/services directory structure.
cd "$source_linux"
while IFS= read -r file || [[ -n "$file" ]]; do
    cp --parents -- "$file" "$destination/"
done < <(printf '%s' '__FILES__' | base64 -d)
chmod -R go-rwx "$destination"
cd "$destination"
# The parent stays private (700 means only root can enter it).
# umask controls default permissions for NEW files and directories.
# 022 allows normal image directory access; 077 would block target users.
# rpi-image-gen briefly uses a target account when preparing its SSH folder.
umask 022

# -----------------------------------------------------------------------------
# Linux: check configuration, then build unless -CheckOnly was selected
# -----------------------------------------------------------------------------

# tee displays output and saves it; pipefail also detects build failures.
echo 'Running build preflight...'
stage='build preflight; see build.log in the Linux build directory above'
bash ./build.sh --check </dev/null 2>&1 | tee build.log
if [[ '__MODE__' == build ]]; then
    echo 'Building the Raspberry Pi image...'
    stage='image build; see build.log in the Linux build directory above'
    bash ./build.sh </dev/null 2>&1 | tee -a build.log
fi

# -----------------------------------------------------------------------------
# Linux: report where the build files were kept
# -----------------------------------------------------------------------------

echo "Completed. Sources, build log and build outputs remain in: $destination"
'@

# -----------------------------------------------------------------------------
# Windows: launch the Linux block and check its exit status
# -----------------------------------------------------------------------------

$bootstrap = $bootstrap.Replace('__PATH__', $pathEncoded).Replace('__FILES__', $filesEncoded).Replace('__SLUG__', $slug).Replace('__MODE__', $mode)
$encodedBootstrap = ConvertTo-BuilderBase64 ($bootstrap.Replace("`r", ''))
$command = "printf '%s' '$encodedBootstrap' | base64 -d | /bin/bash -se"
# --exec bypasses any still-pending interactive Ubuntu account-creation wizard.
Write-Host 'Starting rpi-builder and copying this bundle into Linux...'
$wslArguments = @('--distribution', $distributionName, '--user', 'root', '--exec', '/bin/bash', '-o', 'pipefail', '-c', $command)
& wsl.exe @wslArguments
if ($LASTEXITCODE -ne 0) { throw "WSL build failed (exit $LASTEXITCODE). Review the output and Linux build.log above. Existing files are preserved." }
