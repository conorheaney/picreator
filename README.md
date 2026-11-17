# Pi Creator

A local web application for configuring Raspberry Pi 5 images built with **rpi-image-gen**. The editor creates configuration, layer and script files; it never runs an image build or flashes storage.

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

The standard layout uses `image-rpios`. Custom layouts copy the installed layer into the exported source tree, give it a separate name, and adapt its genimage template. The adapter rejects unfamiliar template structures. GPT/custom layouts disable image provisioning metadata, so these bundles are for ordinary raw-image workflows, not secure provisioning. Automatic root partition growth, encryption, secure boot, RAID, arbitrary partition ordering, and binary file uploads are not implemented.

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

Tests cover validation, export mapping, quoting, archive integrity and permissions, custom layout adaptation, API persistence, conflicting saves, and local request restrictions. Python 3 is used for archive and layout checks; Bash is used to parse generated scripts. Set `BASH_PATH` if Bash is not available on PATH. Browser visual QA was blocked by the unavailable browser automation host and a desktop browser launch timeout.

Source: `public/` holds the frontend and shared validation, `lib/export.mjs` generates bundles, and `server.mjs` provides local project storage and HTTP routes.
