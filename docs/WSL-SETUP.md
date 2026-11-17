## WSL Ubuntu: local root setup and build

### 1. Prepare WSL 2

If you already have an Ubuntu WSL instance, keep it. The bundle script creates a separate distribution named **rpi-builder**. It does not clone, reconfigure or remove your other Ubuntu instances.

If WSL is not enabled, run `wsl --install --no-distribution` in PowerShell as Administrator and restart Windows if requested. Use a current Store WSL version: `wsl --update`. Check availability with `wsl --status` and `wsl --list --verbose`.

### 2. Create a dedicated rpi-builder

Extract the bundle onto the Windows filesystem, open PowerShell in its root folder, then run:

```powershell
.\create-rpi-builder.ps1 -WhatIf
.\create-rpi-builder.ps1
```

**Destructive reset:** if `rpi-builder` already exists, the second command permanently deletes that distribution and all its files, installed tools and image outputs, then creates fresh Ubuntu 24.04 under the same name. Back up anything needed first. Only `rpi-builder` is targeted. Do not rerun this script to resume an existing build environment.

The script then automatically launches a root session in the new instance, installs Git and prerequisites, clones the official rpi-image-gen repository, runs its dependency installer, and enables ARM64 emulation on x86-64 hosts. Progress streams into PowerShell; any failure stops setup. The image bundle is not built automatically.

Run as the Windows user who owns the intended WSL distributions. The script checks named-install support before removal and stops on errors. It downloads Ubuntu through WSL; a failed download after removal cannot restore the old builder. If PowerShell blocks scripts, review your organisation's execution policy rather than changing system policy automatically. If Windows requests a reboot, restart and inspect `wsl --list --verbose` before retrying.

Open the new instance from PowerShell:

```powershell
wsl -d rpi-builder -u root --cd /root
```

This is local root access through your Windows account: no root password or SSH key is required. No root SSH service, empty password or passwordless sudo rule is configured. Type `exit` to leave. To return later, use the same `wsl -d rpi-builder ...` command, not the recreation script.

The setup script also disables Ubuntu's first-run account-creation wizard for this dedicated builder and sets its default user to root. It preserves other WSL settings and saves original configuration backups as `/etc/wsl*.conf.rpi-builder-original`. If an older bundle still prompts `Create a default Unix user account`, cancel with Ctrl+C and run the updated `create-rpi-builder.ps1 -SetupOnly`, then open the instance again. For an immediate root shell that bypasses the wizard, use `wsl -d rpi-builder -u root --cd /root --exec /bin/bash -l`.

**Existing-instance alternative:** to reuse a separate Ubuntu you already configured, skip the script and open it with `wsl -d YOUR_UBUNTU_NAME -u root --cd /root`. Continue below using that instance.

### 3. rpi-image-gen setup (automatic)

After a successful `create-rpi-builder.ps1` run, this step is already complete. The checkout is `/root/rpi-image-gen`; the installed commit is recorded in `/root/rpi-image-gen-revision.txt`. Continue to step 4.

If setup fails, the instance is left in place. Retry installation from PowerShell using the updated script, preserving its files:

```powershell
.\create-rpi-builder.ps1 -SetupOnly
```

`-SetupOnly` requires an existing `rpi-builder` and never unregisters or reinstalls Ubuntu. It keeps an existing rpi-image-gen checkout. Running without this switch still deletes and recreates the builder. The manual steps below also apply if you chose to reuse another Ubuntu instance.

Run in the **WSL root shell**, not PowerShell:

```bash
apt-get update
apt-get install -y --no-install-recommends git ca-certificates binfmt-support qemu-user-static debian-archive-keyring
cd /root
git clone https://github.com/raspberrypi/rpi-image-gen.git
cd /root/rpi-image-gen
./install_deps.sh
git rev-parse HEAD
```

If that repository is already installed, skip cloning and use its path. Record the commit printed above to reproduce the build environment.

On an x86-64 Windows host, confirm ARM64 emulation is registered:

```bash
uname -m
cat /proc/sys/fs/binfmt_misc/qemu-aarch64
```

The registration should report `enabled` and include `F` in its flags. The setup script accepts an existing valid kernel registration; otherwise Ubuntu 24.04's packaged rule is loaded with `/usr/lib/systemd/systemd-binfmt /usr/lib/binfmt.d/qemu-aarch64.conf`. Older packaging uses `update-binfmts` instead. Native ARM64 hosts do not need this emulation step. Resolve registration failures before building.

Ubuntu amd64 cross-building is described by Raspberry Pi as not officially supported; WSL adds another environment dependency. This is a setup guide, not a tested WSL build result. Allow ample Linux filesystem space for the root filesystem, images and temporary artifacts, especially for A/B images.

### 4. Copy the export into Linux and build

Once the builder is ready, run this from PowerShell in the extracted bundle folder:

```powershell
.\build-in-wsl.ps1
```

This starts the existing `rpi-builder`, verifies bundle checksums, copies source files into a new private folder under `/root/pi-projects/`, runs preflight, then builds the Pi image. It preserves previous builds and never recreates the instance or flashes media. Progress appears in PowerShell and is saved in the Linux build directory as `build.log`; rpi-image-gen reports its image output location. Use `-CheckOnly` for preflight only or `-WhatIf` to preview without launching WSL. You can run the script from another working directory; it always copies the bundle beside the script.

To bring the built image and logs back into this bundle, run:

```powershell
.\copy-build-output.ps1
```

This finds the newest deployment with an image whose project.json matches this
bundle, copies its deployment artifacts and logs into `image/<Linux-build-folder>/`,
and verifies each copied file. It preserves the WSL sources and any earlier
collections. Use `-BuildDirectory /root/pi-projects/{{project}}-XXXXXXXX` to select
a particular build, or `/root/rpi-image-gen` for a manual build in that checkout.
The console log is saved as `logs/build.log`; deployment checksums and metadata
are copied alongside the image. `-WhatIf` previews without starting WSL.

For manual copying/building or a different Ubuntu instance, use the steps below.

Export from Pi Creator. In the WSL root shell, replace the archive path with the actual Windows download or export archive path:

```bash
umask 077
mkdir -p /root/pi-projects
tar -xzf '/mnt/c/Users/YOUR_WINDOWS_USER/Downloads/{{project}}.tar.gz' -C /root/pi-projects
cd /root/pi-projects/{{project}}
export RPI_IMAGE_GEN=/root/rpi-image-gen/rpi-image-gen
bash build.sh --check
bash build.sh
```

If the archive has a random ID suffix, use its exact filename. Extract into a fresh directory to avoid retaining older generated files. The archive's internal folder is `{{project}}`. If copying an extracted bundle, place that folder under `/root/pi-projects/` and continue from `cd`.

Build inside Linux, not `/mnt/c`. rpi-image-gen prints the output location. `--check` verifies prerequisites and parsing; a successful build and Pi boot test are still required. `build.sh` never flashes storage.

### SSH customize hook fails with `/bin/sh: Permission denied`

If root chroot commands succeed but `uchroot` fails, check image directory modes.
Earlier builder setup created upstream overlays with mode 700, and the source
copy also made project overlays private. These modes were preserved in the image,
blocking its login user from traversing `/` or `/usr`. Changing umask alone does
not repair existing directories.

Export a fresh bundle, run `./create-rpi-builder.ps1 -SetupOnly` to repair the
existing upstream checkout, then run `./build-in-wsl.ps1` for a fresh build. Setup
preserves the builder; generated build.sh restores project overlay directory and
file permissions while keeping the enclosing bundle private.

References: [Microsoft WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands), [Raspberry Pi cross-build setup](https://github.com/raspberrypi/rpi-image-gen/blob/master/getting_started.adoc).


## Save and restore a clean builder

After `create-rpi-builder.ps1` finishes, and before building any projects, save a baseline:

```powershell
.\rpi-builder-snapshot.ps1 backup
```

Before each subsequent build, restore it and then launch the build:

```powershell
.\rpi-builder-snapshot.ps1 restore
.\build-in-wsl.ps1
```

Restore permanently discards changes and build outputs inside `rpi-builder` since the snapshot. Copy any images you want to keep to Windows first. Windows export folders and other distributions are unaffected. Both actions stop the builder; close its terminals and finish running builds first.

The default snapshot is `rpi-builder.tar` beside `rpi-builder-snapshot.ps1` in the exported bundle folder, with a SHA-256 checksum beside it. This location follows the script, even when launched from another working directory. Each export folder has its own baseline. The build launcher copies only manifest-listed source files, so snapshots are not copied into WSL or included in generated image inputs. Keep this folder (and allow enough disk space for the full Linux snapshot) if you want to restore it later. `backup` replaces that baseline with the current state; it includes any builds already present. Use `-BackupPath D:\Backups\rpi-builder.tar` on either action for another snapshot. Keep the `.sha256` file with the archive. Use `restore -WhatIf` to preview. A snapshot may contain credentials, so store it privately.

This uses [WSL export/import](https://learn.microsoft.com/en-us/windows/wsl/basic-commands) to save and recreate the Linux builder. It does not create or flash a Raspberry Pi disk image. ARM64 emulation is a host runtime setting; if a build reports it missing after a Windows/WSL restart, rerun `create-rpi-builder.ps1 -SetupOnly`.
