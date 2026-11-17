import { readFileSync } from 'node:fs';
const guide = readFileSync(new URL('../docs/WSL-SETUP.md', import.meta.url), 'utf8');
export const wslGuide = slug => guide.replaceAll('{{project}}', slug);
export const builderSetupScript = () => readFileSync(new URL('../templates/create-rpi-builder.ps1', import.meta.url), 'utf8');
export const builderRunScript = () => readFileSync(new URL('../templates/build-in-wsl.ps1', import.meta.url), 'utf8');
export const builderSnapshotScript = () => readFileSync(new URL('../templates/rpi-builder-snapshot.ps1', import.meta.url), 'utf8');
export const builderOutputScript = () => readFileSync(new URL('../templates/copy-build-output.ps1', import.meta.url), 'utf8');
