#Requires -Version 5.1
<#
.SYNOPSIS
Copy the built image, deployment artifacts and build logs into this bundle.
.DESCRIPTION
Uses rpi-builder. By default, selects the newest deployment with an image whose
source project.json matches this bundle. -BuildDirectory selects a Linux build
folder explicitly, for example /root/pi-projects/simple-pi-F6pXvsKU or
/root/rpi-image-gen for a manual build. Sources in WSL are preserved.
Each build is collected under image/<Linux-build-folder> beside this script.
Existing collections are preserved. -WhatIf previews without starting WSL.
.EXAMPLE
.\copy-build-output.ps1
.EXAMPLE
.\copy-build-output.ps1 -BuildDirectory /root/pi-projects/simple-pi-F6pXvsKU
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$BuildDirectory = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$bundlePath = $PSScriptRoot
$projectPath = Join-Path $bundlePath 'project.json'
$project = Get-Content -Raw -LiteralPath $projectPath | ConvertFrom-Json
$slug = [string]$project.project.slug
if ($slug -notmatch '^[a-z0-9][a-z0-9-]{0,62}$') { throw 'Invalid project slug in project.json.' }
if ($BuildDirectory -and (-not $BuildDirectory.StartsWith('/') -or $BuildDirectory -match '[\x00-\x1f]')) {
    throw 'BuildDirectory must be an absolute Linux directory path.'
}
if (-not $PSCmdlet.ShouldProcess((Join-Path $bundlePath 'image'), 'Copy image, deployment artifacts and logs from rpi-builder')) { return }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'WSL is not installed.' }
$installed = @(& wsl.exe --list --quiet | ForEach-Object { ([string]$_).Replace([string][char]0, '').Trim() })
if ($LASTEXITCODE -ne 0) { throw 'Could not list WSL distributions.' }
if ($installed -notcontains 'rpi-builder') { throw 'rpi-builder is missing.' }

function ConvertTo-OutputBase64([string]$Value) {
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
}
$bootstrap = @'
#!/bin/bash
# Copy outputs only; never build, install, delete or modify the Linux source.
set -Eeuo pipefail
umask 077
trap 'status=$?; echo "Output collection failed (line $LINENO, exit $status). Any partial copy stays in .collect-* for inspection." >&2; exit "$status"' ERR
bundle=$(wslpath -u "$(printf '%s' '__BUNDLE__' | base64 -d)")
requested=$(printf '%s' '__BUILD__' | base64 -d)
slug='__SLUG__'
expected='__HASH__'
shopt -s nullglob
selected=''
deployment=''
newest=-1
if [[ -n "$requested" ]]; then
    candidates=("$requested")
else
    candidates=(/root/pi-projects/"$slug"-*)
fi
for candidate in "${candidates[@]}"; do
    [[ -d "$candidate" ]] || continue
    if [[ -z "$requested" ]]; then
        [[ -f "$candidate/project.json" ]] || continue
        actual=$(sha256sum "$candidate/project.json")
        [[ "${actual%% *}" == "$expected" ]] || continue
    fi
    for deploy in "$candidate"/work/deploy-*; do
        [[ -d "$deploy" ]] || continue
        # Upstream writes this manifest after all deployment hooks finish.
        [[ -f "$deploy/deployed.json" ]] || continue
        images=("$deploy"/*.img "$deploy"/*.img.zst "$deploy"/*.img.gz "$deploy"/*.img.xz)
        [[ ${#images[@]} -gt 0 ]] || continue
        modified=$(stat -c %Y "$deploy")
        if (( modified > newest )); then
            newest=$modified
            selected=$(realpath "$candidate")
            deployment=$deploy
        fi
    done
done
if [[ -z "$selected" ]]; then
    echo 'No matching completed deployment found (image and deployed.json required). Finish the build first, or pass -BuildDirectory with its Linux source directory.' >&2
    exit 1
fi
name=$(basename "$selected")
[[ "$name" != . && "$name" != .. && "$name" != / ]] || exit 1
destination="$bundle/image/$name"
if [[ -e "$destination" ]]; then
    echo "Outputs already exist: $destination. Move that collection aside before copying it again." >&2
    exit 1
fi
mkdir -p "$bundle/image"
staging=$(mktemp -d "$bundle/image/.collect-XXXXXXXX")
copy_verified() {
    local source=$1 relative=$2
    mkdir -p "$(dirname "$staging/$relative")"
    cp -- "$source" "$staging/$relative"
    cmp --silent -- "$source" "$staging/$relative"
    printf 'Copied %s\n' "$relative"
}
echo "Linux build: $selected"
echo "Deployment: $deployment"
# The deploy folder contains the compressed image, checksums and provenance.
while IFS= read -r -d '' file; do
    copy_verified "$file" "${file#"$deployment/"}"
done < <(find "$deployment" -type f -print0)
if [[ -f "$selected/build.log" ]]; then
    copy_verified "$selected/build.log" logs/build.log
else
    echo 'No build.log present (manual builds must capture console output themselves).' >&2
fi
# Preserve additional build-tool logs, excluding runtime logs inside the image.
if [[ -d "$selected/work" ]]; then
    while IFS= read -r -d '' file; do
        copy_verified "$file" "logs/${file#"$selected/"}"
    done < <(find "$selected/work" -type d -name filesystem -prune -o -type f -name '*.log' -print0)
fi
printf 'Build: %s\nDeployment: %s\nCopied (UTC): %s\n' "$selected" "$deployment" "$(date -u +%FT%TZ)" > "$staging/build-source.txt"
mv -T -- "$staging" "$destination"
echo "Collected outputs: $(wslpath -w "$destination")"
'@
$bootstrap = $bootstrap.Replace('__BUNDLE__', (ConvertTo-OutputBase64 $bundlePath)).Replace('__BUILD__', (ConvertTo-OutputBase64 $BuildDirectory)).Replace('__SLUG__', $slug).Replace('__HASH__', (Get-FileHash -LiteralPath $projectPath -Algorithm SHA256).Hash.ToLowerInvariant())
$encoded = ConvertTo-OutputBase64 ($bootstrap.Replace("`r", ''))
$command = "printf '%s' '$encoded' | base64 -d | /bin/bash -se"
& wsl.exe --distribution rpi-builder --user root --exec /bin/bash -o pipefail -c $command
if ($LASTEXITCODE -ne 0) { throw "Output collection failed (exit $LASTEXITCODE). Linux build files are preserved." }
