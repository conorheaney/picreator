# Pi Creator

A local web application for configuring Raspberry Pi 5 images built with **rpi-image-gen**. The editor creates configuration, layer and script files; it never runs an image build or flashes storage.

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

For manual copying/building or a different Ubuntu instance, use the steps below.

Export from Pi Creator. In the WSL root shell, replace the archive path with the actual Windows download or export archive path:

```bash
umask 077
mkdir -p /root/pi-projects
tar -xzf '/mnt/c/Users/YOUR_WINDOWS_USER/Downloads/simple-pi.tar.gz' -C /root/pi-projects
cd /root/pi-projects/simple-pi
export RPI_IMAGE_GEN=/root/rpi-image-gen/rpi-image-gen
bash build.sh --check
bash build.sh
```

If the archive has a random ID suffix, use its exact filename. Extract into a fresh directory to avoid retaining older generated files. The archive's internal folder is `simple-pi`. If copying an extracted bundle, place that folder under `/root/pi-projects/` and continue from `cd`.

Build inside Linux, not `/mnt/c`. rpi-image-gen prints the output location. `--check` verifies prerequisites and parsing; a successful build and Pi boot test are still required. `build.sh` never flashes storage.

References: [Microsoft WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands), [Raspberry Pi cross-build setup](https://github.com/raspberrypi/rpi-image-gen/blob/master/getting_started.adoc).

## Run

Install Node.js 22 or newer. No npm dependencies or cloud services are needed.

```powershell
cd C:\Projects\Tools\picreator
npm start
```

Open **http://127.0.0.1:4310**. Keep the terminal running. Use `Ctrl+C` to stop the server. Set `PORT` if you need a different port.

## Workflow

1. Give the project a name and folder name.
2. Configure system, users, networking, storage, USB Ethernet, hardware, and packages. Help is shown beside each setting.
3. Add an SSH public key or a password hash to avoid locking yourself out. To generate a hash interactively in WSL, run `openssl passwd -6`.
4. Click **Save project** (or Ctrl+S). Drafts can be saved before all settings are valid.
5. Use **Review & export** to address validation errors and preview generated files.
6. Create an export. The editor writes a complete folder under `exports/` and offers a `.tar.gz` download.
7. Copy/extract that folder into your WSL Ubuntu home directory. Follow its `README.md`, run `bash build.sh --check`, then `bash build.sh`.

Projects live under `data/<project-id>/project.json`. This is one JSON file containing all settings plus save metadata. The exported `project.json` and the **Download current JSON** action provide a portable configuration. Both forms can be imported through **Projects → Import JSON**. The browser remembers only the last project's identifier. Project data stays on the local server.

## Implemented settings

Generated project-owned files use the export folder name as their namespace. For `simple-pi`, examples are `layer/simple-pi-settings.yaml`, `layer/simple-pi-image.yaml`, `00-simple-pi-ssh.conf`, and `simple-pi-ethernet.nmconnection`. Conventional upstream names such as `config.yaml`, `fstab`, `genimage.cfg.in`, `config.txt` and `build.sh` remain recognisable. User-chosen application service names are retained. Re-export to obtain the new filenames; existing export snapshots and running images are not renamed automatically. All generated Bash entry points have comments describing their role, inputs and privilege boundary. User-authored text-file contents are preserved.

- Pi 5 ARM64, Trixie/Bookworm minimal suites, SD/NVMe, hostname, locale, timezone and keyboard.
- Multiple users, UIDs, groups, password hashes, public keys, sudo modes, SSH port and authentication.
- Restricted service accounts with locked passwords, no login shell, no sudo, and opt-in hardware groups.
- Guided application services: account, executable and literal arguments, working directory, restart policy, boot enablement, network isolation and writable data directories.
- Ethernet DHCP/static, WPA/WPA2 Wi-Fi, country code, hidden SSID and mDNS.
- MBR/GPT, boot/root sizes, ext4/btrfs root, disk signature, extra ext4 data partitions and mount paths.
- USB Ethernet using dwc2/g_ether, DHCP client/shared/manual IPv4 and separate host/device MAC addresses.
- I²C, SPI, UART, Wi-Fi/Bluetooth disabling, firmware settings and kernel arguments.
- Packages, systemd enable/mask rules, additional layers, configuration overrides, text files and a custom target-side script.

## Development accounts and restricted services

**Users & access** lists root, human login accounts and service accounts in one table. Use **Edit**, **+ Login account** or **+ Service account** to open a dialog. Changes apply only when you select **Save account**. **Delete** asks for confirmation; accounts still assigned to services must be reassigned before deletion. The last login account is retained because the base image requires one. **Recommended builds** opens guidance for Development/provisioning, QA and Release, including root SSH and individual key recommendations.

For development/provisioning as root, open **Users & access** and select **Use root SSH + appsvc preset**. Paste your public key in **Root SSH public keys**. This enables key-only root login and creates one restricted `appsvc` account shared by your web apps, API and background services. Existing guided application services are reassigned to `appsvc`. Add each application under **Application services** using that account. The preset replaces existing service-account definitions; review hardware groups afterwards. Services sharing an account can access each other's account-owned data.

Connect with `ssh root@<hostname>.local` (or the Pi's IP). Root SSH passwords remain disabled. Turn off **Allow root SSH with a key** when creating a production configuration. An importable draft is supplied at `examples/dev-provisioning.json`; add your own public key before exporting. Ordinary login accounts are preserved by the preset; the example's `pi` account has no credentials or sudo.

1. In **Users & access**, keep your human SSH account and configure its sudo access as needed.
2. Below the login accounts, add a **Restricted service account**. It cannot log in or use sudo. Select only necessary hardware groups (GPIO, I²C, SPI, serial, video, render or audio).
3. In **Application services**, add a service and select that account. Enter the absolute executable path, one literal argument per line, and the working directory. Supply the application using packages, target files or a build script.
4. Choose a persistent directory name: `myapp` creates `/var/lib/myapp` owned by the service account with mode 0700. An optional runtime directory is created under `/run`. Extra writable directories may be placed under `/data`, `/srv` or `/mnt`; a directory-preparation unit creates them after the relevant filesystems mount.
5. Leave **Start at boot** off for manual development testing. Use `sudo systemctl start myapp` and `sudo journalctl -u myapp -f` after boot.

Generated services have no capabilities, cannot gain privileges, hide home directories and make the system filesystem read-only. They have private temporary storage. Physical devices are hidden unless the account has hardware groups; then Linux device permissions apply. Enable the relevant interface under Hardware & boot separately. Network access can also be disabled. These are foreground services; daemonising programs should be configured to stay in the foreground.

`sudo -u myservice /path/to/test` tests account permissions but not the complete systemd sandbox. Use the generated service to test its actual restrictions. Exports include readable units under `services/` and a `SERVICES.md` guide. Existing project files automatically gain empty service-account and service lists when opened/imported; existing login settings remain unchanged.

## Compatibility and verification limits

Storage controls are ordered as image strategy, target capacity, partition table, then collapsed advanced layout options. The right-hand panel explains development, application data, field updates and capacity planning. Standard data mounts may use custom absolute paths such as `/simple-pi-data`, `/data`, or `/opt/myapp/data`. Protected system trees (including `/etc`, `/usr`, `/boot`, `/var`, `/home`, runtime/pseudo-filesystems and upstream A/B mount points) are blocked by editor policy. Spaces, dot segments and overlapping/nested data mounts are rejected. Service extra writable paths accept the same application directories; A/B services continue to use their guided persistent state directories.

The partition table now shows partition number, name, filesystem label/type, resolved size, mount and purpose. Edit opens a dialog; cancelling leaves settings unchanged. Standard data partitions can be added and deleted with confirmation. Field-update partitions have a fixed upstream order: `bootconfig`, `boot_a`, `boot_b`, `system_a`, `system_b`, `persistent`. BOOTCONFIG is fixed at 32 MiB, GPT alignment is 8 MiB, boot partitions are VFAT, system partitions use upstream-default EROFS, and persistent data uses ext4. Paired slot sizes change together. Exports include `partitions.json` with this same plan. The native `image-rota` layer builds the layout; its fixed partition names/order cannot be changed through the editor.

**Storage & partitions → Image strategy** offers Standard or Field updates (A/B). A/B selects upstream `image-rota` with two read-only EROFS system slots, paired boot slots, a 32 MiB BOOTCONFIG partition and shared persistent data. The guided service state directories can be shared across slots. This creates the storage foundation and optionally an upstream otamaker payload; update delivery, signing, health confirmation and rollout remain deployment integrations. The export includes `UPDATE-STRATEGY.md`. Extra Standard partitions are retained in the project and ignored in A/B builds. Keep identities and shared-data schema compatible across releases.

**Target storage capacity → Use remaining capacity for data** calculates data size from the destination capacity in decimal GB. A/B uses its persistent partition; Standard uses the last additional data partition. Boot/system/other partition sizes must be absolute M/G values. The calculation subtracts those sizes and a 64 MiB reserve for layout metadata, alignment and small media variations. It rejects insufficient space. The export's `STORAGE.md` reports resolved sizes. This is build-time sizing: it does not automatically grow partitions on first boot or detect actual hardware capacity. Enter a conservative capacity supported by all destination media, or create separate exports for different sizes.

The exporter follows the upstream layer-based interface documented on **2026-11-16**. Upstream references:

- [Configuration system](https://raspberrypi.github.io/rpi-image-gen/config/index.html)
- [Layer and hook interface](https://raspberrypi.github.io/rpi-image-gen/layer/index.html)
- [Pi OS image layout](https://raspberrypi.github.io/rpi-image-gen/layer/image-rpios.html)
- [Cross-building instructions](https://github.com/raspberrypi/rpi-image-gen/blob/master/getting_started.adoc)
- [USB gadget reference and Windows driver](https://github.com/raspberrypi/rpi-usb-gadget)
- [systemd service identities and permissions](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)

The standard two-partition layout uses native `image-rpios`. Custom Standard layouts export a complete `<project-slug>-image` extension layer depending on `image-rpios` for its declared variables and base support. The bundle already contains its genimage template, filesystem settings and fstab. A normal preimage hook resolves build-time paths and filesystem IDs; `build.sh` does not create, copy or patch layout assets. No exported Python helper is used. GPT/custom layouts disable provisioning metadata. Automatic partition growth, encryption, secure boot, RAID, arbitrary partition ordering and binary uploads are not implemented.

Export policy: use upstream config variables for device identity, primary user credentials/groups/UID/sudo, primary SSH keys, locale, image sizes and package selection. Firmware/kernel settings use native drop-in directories. SSH policy, NetworkManager profiles, module options, service-related configuration and user text files are plain files in `customize.overlay`, with target modes preserved. Build hooks remain for additional accounts, locked service identities, SSH key ownership, checked service-unit installation and systemd enable/mask operations, plus optional user scripts. They are rpi-image-gen layer lifecycle hooks, not build.sh preprocessing. NetworkManager keyfiles are generated in the editor with mode 0600; special characters are data, never shell expressions.

The USB setup uses a fixed NetworkManager profile, not the official package's automatic client/shared switching service. Hardware, power, host drivers and host-side networking must be tested on the actual devices.

Ubuntu amd64 cross builds are described as not officially supported by upstream. You need a functioning rpi-image-gen installation, dependencies, and ARM64 emulation in WSL already configured. `--check` checks prerequisites and YAML parsing; it does not simulate a complete build. No WSL image build or Raspberry Pi hardware test has been performed in this development environment. Test an image on a spare device before relying on it.

## Local security and storage

The server binds only to loopback and rejects foreign Origin/Host headers. There is no telemetry or remote account. Project files can contain Wi-Fi secrets and password hashes; protect your Windows account, project backups and exports. File modes are restrictive on Linux; Windows relies on the directory's inherited ACLs. Custom scripts and advanced overrides are trusted build code and must be reviewed before execution.

Save uses atomic replacement and revision checks to prevent silent overwrites from multiple tabs. Export always uses a saved revision. Export folders are independent snapshots and are never silently overwritten. Configure `PICREATOR_DATA` and `PICREATOR_EXPORTS` environment variables to relocate storage.

## Development

```powershell
npm run check
npm test
```

Tests cover validation, export mapping, quoting, archive integrity and permissions, native image-layer generation, API persistence, conflicting saves, and local request restrictions. Python 3 is used only for an archive test; Bash is used to parse generated scripts. Set `BASH_PATH` if Bash is not available on PATH. Browser visual QA was blocked by the unavailable browser automation host and a desktop browser launch timeout.

Source: `public/` holds the frontend and shared validation, `lib/export.mjs` generates bundles, and `server.mjs` provides local project storage and HTTP routes.


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
