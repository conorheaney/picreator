#Requires -Version 5.1
<#
.SYNOPSIS
Create a fresh Ubuntu 24.04 WSL 2 distribution named rpi-builder.
.DESCRIPTION
DESTRUCTIVE: if rpi-builder exists, unregistering it permanently deletes all
of that distribution's files, installed tools and build outputs. No backup is
made. Other WSL distributions, including existing Ubuntu installs, are untouched.
This script prepares a clean local builder, not the Raspberry Pi target image.
It launches the new instance as root, clones the official rpi-image-gen repository,
installs its dependencies and configures ARM64 emulation on x86-64 hosts.
It does not run an image build or flash storage; follow README.md afterwards.
.EXAMPLE
.\create-rpi-builder.ps1 -WhatIf
Show the planned reset without changing WSL.
.EXAMPLE
.\create-rpi-builder.ps1
Replace rpi-builder if present, install fresh Ubuntu and default its user to root.
.EXAMPLE
.\create-rpi-builder.ps1 -SetupOnly
Resume dependency installation in an existing rpi-builder without recreating it.
.NOTES
Run in Windows PowerShell as the Windows user who owns your WSL distributions.
Requires an already-enabled WSL 2 platform and a current Store WSL supporting
--install --name and --manage --set-default-user. Network access is required.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$SetupOnly)


# -----------------------------------------------------------------------------
# Windows: choose the dedicated builder and handle errors
# -----------------------------------------------------------------------------

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The destructive target is deliberately fixed, never read from project settings.
$distributionName = 'rpi-builder'
$ubuntuRelease = 'Ubuntu-24.04'


# -----------------------------------------------------------------------------
# Windows: helper for running WSL commands reliably
# -----------------------------------------------------------------------------

function Invoke-BuilderWsl {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    # PowerShell 5.1 does not turn native nonzero exit codes into exceptions.
    # Check every command explicitly and stop rather than continuing a partial reset.
    $isHelp = $Arguments.Count -eq 1 -and $Arguments[0] -eq '--help'
    if ($isHelp) {
        # Some WSL releases return -1 for successful help output. Capture both
        # streams without treating help's native stderr as a PowerShell exception.
        # The caller still validates the actual install options BEFORE any reset.
        $savedPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & wsl.exe @Arguments 2>&1
        } finally { $ErrorActionPreference = $savedPreference }
    } else {
        & wsl.exe @Arguments
    }
    # This exception applies ONLY to --help. A failed status, unregister, install
    # or default-user command must always stop the script, including exit -1.
    if ($LASTEXITCODE -ne 0 -and -not ($isHelp -and $LASTEXITCODE -eq -1)) {
        if ($Arguments[0] -eq '--distribution') {
            throw "WSL command failed (exit $LASTEXITCODE): rpi-builder dependency setup. Review the output above. The instance is kept; retry with .\create-rpi-builder.ps1 -SetupOnly to preserve it."
        }
        throw "WSL command failed (exit $LASTEXITCODE): wsl.exe $($Arguments -join ' ')"
    }
}


# -----------------------------------------------------------------------------
# Windows: check WSL capabilities before changing the builder
# -----------------------------------------------------------------------------

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'WSL is not installed. Run wsl --install --no-distribution in elevated PowerShell, reboot if requested, then retry.'
}

# Validate capabilities before removing an existing builder. The install-specific
# block avoids confusing --mount --name with the newer --install --name option.
$helpText = ((Invoke-BuilderWsl -Arguments @('--help')) -join "`n").Replace([string][char]0, '')
$installBlock = [regex]::Match($helpText, '(?ms)^ {4}--install\b(?<options>.*?)(?=^ {4}--[a-z]|\z)').Value
if (-not $SetupOnly -and ($installBlock -notmatch '--name\b' -or $installBlock -notmatch '--version\b' -or $helpText -notmatch '--set-default-user\b')) {
    throw 'This WSL version does not expose the required named-install/default-user options. Run wsl --update and retry. No distribution has been removed.'
}
Invoke-BuilderWsl -Arguments @('--status')


# -----------------------------------------------------------------------------
# Windows: choose creation or repair and honour -WhatIf
# -----------------------------------------------------------------------------

# --quiet output can contain UTF-16 null characters when captured by PowerShell.
# Compare complete trimmed names; never use a substring/wildcard for unregistering.
$installed = @((Invoke-BuilderWsl -Arguments @('--list', '--quiet')) | ForEach-Object {
    ([string]$_).Replace([string][char]0, '').Trim()
})
$exists = $installed -contains $distributionName
if ($SetupOnly -and -not $exists) {
    throw 'rpi-builder does not exist. Run without -SetupOnly to create it.'
}
$action = if ($exists) { 'PERMANENTLY DELETE the existing rpi-builder, install fresh Ubuntu 24.04 WSL 2 and configure rpi-image-gen' } else { 'Install fresh Ubuntu 24.04 WSL 2 and configure rpi-image-gen' }
if ($SetupOnly) { $action = 'Install or repair rpi-image-gen dependencies in the existing rpi-builder (keep its files)' }

# -WhatIf returns here without termination, unregister, installation or user changes.
if (-not $PSCmdlet.ShouldProcess($distributionName, $action)) { return }

# -----------------------------------------------------------------------------
# Windows: replace the builder only when a fresh setup was requested
# -----------------------------------------------------------------------------

if (-not $SetupOnly) {
    if ($exists) {
        Write-Warning 'Deleting rpi-builder permanently, including all Linux files and build outputs. Other distributions are unaffected.'
        # Stop only this distribution. Do not shut down unrelated WSL sessions.
        # Unregister handles its own shutdown and disk removal; no filesystem deletion.
        Invoke-BuilderWsl -Arguments @('--unregister', $distributionName)
    }

    # --no-launch avoids entering Ubuntu's interactive first-user setup here.
    # Windows may request elevation for installation; never auto-relaunch as another user.
    Invoke-BuilderWsl -Arguments @('--install', '--distribution', $ubuntuRelease, '--name', $distributionName, '--version', '2', '--no-launch')

    # Verify the exact instance exists before applying any configuration to it.
    $afterInstall = @((Invoke-BuilderWsl -Arguments @('--list', '--quiet')) | ForEach-Object {
        ([string]$_).Replace([string][char]0, '').Trim()
    })
    if ($afterInstall -notcontains $distributionName) {
        throw 'WSL did not register rpi-builder. If a Windows restart is required, restart first and inspect wsl --list --verbose before retrying. Rerunning this script resets an existing builder.'
    }

    # This is local root access through the owning Windows account, not root SSH.
    # No empty root password, SSH key, SSH server or passwordless sudo is configured.
    Invoke-BuilderWsl -Arguments @('--manage', $distributionName, '--set-default-user', 'root')
}

# -----------------------------------------------------------------------------
# Windows: prepare the Linux installation block
# -----------------------------------------------------------------------------

# Launch a noninteractive root session in this exact distribution. The installer
# is visible below for review; encoding only protects it from Windows/WSL shell
# quoting and line-ending differences. It is not downloaded from an opaque URL.
# Commands fail immediately and their output is streamed to this PowerShell window.
$bootstrap = @'
#!/bin/bash
# Build-host setup only: these commands run INSIDE rpi-builder as root.
# No Raspberry Pi disk image, partition or exported configuration is modified.
# Network access is required for Ubuntu packages and the official Git repository.

# -----------------------------------------------------------------------------
# Linux: run the setup as root and stop on failure
# -----------------------------------------------------------------------------

set -euo pipefail
trap 'echo "Builder setup failed at line $LINENO. Retry create-rpi-builder.ps1 -SetupOnly to preserve this instance." >&2' ERR
test "$(id -u)" = 0 || { echo 'Builder setup requires root.' >&2; exit 1; }
umask 077
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a


# -----------------------------------------------------------------------------
# Linux: configure local root access and skip the first-user wizard
# -----------------------------------------------------------------------------

# A noninteractive --exec session bypasses Ubuntu's first-run wizard but does
# not mark it complete. Configure the manifest's OOBE as a successful no-op,
# with UID 0, so the next interactive launch cannot ask to create a user.
# Preserve other sections (including systemd settings) and keep original backups.
set_builder_ini() {
    local file="$1" section="$2" key="$3" value="$4" temporary
    if [[ ! -e "$file" ]]; then touch "$file"; fi
    if [[ ! -e "$file.rpi-builder-original" ]]; then cp -p "$file" "$file.rpi-builder-original"; fi
    temporary=$(mktemp)
    awk -v section="$section" -v key="$key" -v value="$value" '
        BEGIN { inside=0; found_section=0; written=0 }
        /^[[:space:]]*\[/ {
            if (inside && !written) { print key " = " value; written=1 }
            name=$0; sub(/^[[:space:]]*\[/,"",name); sub(/\].*$/,"",name)
            inside=(tolower(name)==tolower(section))
            if (inside) found_section=1
        }
        inside && tolower($0) ~ "^[[:space:]]*" tolower(key) "[[:space:]]*=" {
            if (!written) { print key " = " value; written=1 }
            next
        }
        { print }
        END {
            if (!found_section) print "\n[" section "]"
            if (!written) print key " = " value
        }
    ' "$file" > "$temporary"
    install -m 644 "$temporary" "$file"
    rm -f "$temporary"
}
echo 'Configuring local root access without the Ubuntu account-creation wizard...'
set_builder_ini /etc/wsl-distribution.conf oobe command /bin/true
set_builder_ini /etc/wsl-distribution.conf oobe defaultUid 0
set_builder_ini /etc/wsl.conf user default root


# -----------------------------------------------------------------------------
# Linux: install the initial download and package tools
# -----------------------------------------------------------------------------

# Update package metadata and bootstrap the trusted tools used by the upstream
# installer. Never upgrade an existing unrelated Ubuntu distribution.
echo 'Installing Ubuntu prerequisites...'
apt-get update </dev/null
apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends git ca-certificates debian-archive-keyring </dev/null


# -----------------------------------------------------------------------------
# Linux: enable ARM64 programs on an x86-64 build host
# -----------------------------------------------------------------------------

# x86-64 Windows needs ARM64 user-mode emulation for package operations in the
# target chroot. A native ARM64 WSL host can execute target code directly.
case "$(uname -m)" in
    x86_64)
        apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends binfmt-support qemu-user-static </dev/null
        # Ubuntu 24.04 ships systemd binfmt.d rules, not necessarily an
        # update-binfmts database entry. An enabled kernel handler with F
        # (fixed interpreter for chroots) is sufficient, regardless of manager.
        arm64_handler_ready() {
            test -r /proc/sys/fs/binfmt_misc/qemu-aarch64 &&
                grep -q '^enabled' /proc/sys/fs/binfmt_misc/qemu-aarch64 &&
                grep -q '^flags:.*F' /proc/sys/fs/binfmt_misc/qemu-aarch64
        }
        if ! arm64_handler_ready; then
            # Register only ARM64; never unregister or restart every handler.
            if ! mountpoint -q /proc/sys/fs/binfmt_misc; then
                mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
            fi
            if [[ -x /usr/lib/systemd/systemd-binfmt && -r /usr/lib/binfmt.d/qemu-aarch64.conf ]]; then
                /usr/lib/systemd/systemd-binfmt /usr/lib/binfmt.d/qemu-aarch64.conf
            elif [[ -r /usr/share/binfmts/qemu-aarch64 ]]; then
                # Older Ubuntu packaging uses the legacy database instead.
                update-binfmts --import qemu-aarch64 </dev/null
                update-binfmts --enable qemu-aarch64 </dev/null
            else
                echo 'No packaged ARM64 binfmt registration rule was found.' >&2
                exit 1
            fi
        fi
        if ! arm64_handler_ready; then
            echo 'ARM64 binfmt handler must be enabled with flag F for chroot builds.' >&2
            exit 1
        fi
        cat /proc/sys/fs/binfmt_misc/qemu-aarch64
        ;;
    aarch64|arm64) echo 'Native ARM64 host: QEMU registration is not required.' ;;
    *) echo 'Unsupported build-host architecture.' >&2; exit 1 ;;
esac


# -----------------------------------------------------------------------------
# Linux: fetch rpi-image-gen and install its dependencies
# -----------------------------------------------------------------------------

# This fresh instance gets its own checkout; no host or other-distro repository
# is reused. Preserve an existing checkout if repairing this block manually.
echo 'Fetching the official rpi-image-gen repository...'
# Overlay modes are copied into the image. /root keeps this checkout private.
umask 022
if [[ ! -e /root/rpi-image-gen ]]; then
    git clone https://github.com/raspberrypi/rpi-image-gen.git /root/rpi-image-gen </dev/null
fi
test -d /root/rpi-image-gen/.git
# Repair checkouts created by earlier setup scripts with umask 077, including
# executable overlay files that must also run as unprivileged target users.
chmod -R go+rX /root/rpi-image-gen
cd /root/rpi-image-gen
# Use upstream's own dependency manifest instead of duplicating its package list.
echo 'Installing rpi-image-gen dependencies...'
bash ./install_deps.sh </dev/null


# -----------------------------------------------------------------------------
# Linux: record the installed version and check the Pi 5 layer
# -----------------------------------------------------------------------------

# Record the exact revision for reproducibility and provide a convenient command
# in future login shells. build.sh can also use the explicit executable path.
git rev-parse HEAD > /root/rpi-image-gen-revision.txt
printf '%s\n' 'export RPI_IMAGE_GEN=/root/rpi-image-gen/rpi-image-gen' > /etc/profile.d/rpi-image-gen.sh
ln -sfn /root/rpi-image-gen/rpi-image-gen /usr/local/bin/rpi-image-gen
./rpi-image-gen layer --describe rpi5 >/dev/null
echo 'rpi-image-gen setup complete. Installed commit:'
cat /root/rpi-image-gen-revision.txt
'@

# -----------------------------------------------------------------------------
# Windows: launch setup in WSL and show the next steps
# -----------------------------------------------------------------------------

$encodedBootstrap = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootstrap.Replace("`r", '')))
$bootstrapCommand = "printf '%s' '$encodedBootstrap' | base64 -d | /bin/bash -se"
Write-Host 'Starting rpi-builder and installing build tools. This can take several minutes...'
Invoke-BuilderWsl -Arguments @('--distribution', $distributionName, '--user', 'root', '--exec', '/bin/bash', '-o', 'pipefail', '-c', $bootstrapCommand)
Write-Host 'rpi-builder is ready with rpi-image-gen and its dependencies.'
Write-Host 'Open it with: wsl -d rpi-builder -u root --cd /root'
Write-Host 'Keep your existing Ubuntu sessions as they are. Run this reset script only when you want to discard the builder.'
