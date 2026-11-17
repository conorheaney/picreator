# Pi Creator for Windows

Run `PiCreator.exe`. It contains the C# WinForms/WebView2 host, Node.js, the complete web app and a self-contained .NET runtime. No Node.js or .NET installation is needed on the destination machine. Windows x64 and the [Microsoft WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) are required (normally present on Windows 11). WSL and rpi-builder are needed only for Pi image builds, as before.

Only the executable is needed to launch the app. .NET native libraries and the embedded application extract at runtime; this is a single-file distribution, not an execution-without-extraction format. The WebView2 browser engine is supplied by Windows, not bundled into the executable. See [Microsoft's WebView2 distribution guidance](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution).

## Build

From the repository root:

```powershell
.\dist\build.ps1
# Include the packaged WebView and export smoke check:
.\dist\build.ps1 -SmokeTest
```

Build prerequisites: Windows x64, .NET 10 SDK, Node.js 22+ x64. NuGet access is needed for WebView2 and .NET publish components; Node's upstream license is downloaded for the installed Node version. The builder packages current source from the parent repository. C# source is under `desktop/`; intermediate payloads are under `.build/`. The output is `dist/PiCreator.exe`. Keep `NODE-LICENSE.txt` with redistributed copies to preserve Node's third-party notices.

## Files and lifecycle

- Projects: `data/` beside the executable. Existing browser-app projects can be imported from their exported `project.json` files.
- Exported bundles: `exports/` beside the executable. Their build and snapshot scripts work as before.
- Browser profile and logs: `%LOCALAPPDATA%\PiCreator`. The app reports a startup error if WebView2 is missing.
- Runtime payload: a fresh `%LOCALAPPDATA%\PiCreator\runtime/` subfolder per run, removed on normal exit. After a forced termination a leftover extraction folder may remain.
- The loopback server binds to a free port and is stopped when the window closes. A Windows job also kills the child server if the wrapper crashes. One instance per executable directory prevents competing writes.

Keep the executable in a writable folder rather than Program Files. Updating the executable preserves adjacent data and exports; do not delete those folders when replacing a build. Personal projects, snapshots and WSL distributions are excluded from the executable. Rebuilding does not modify the existing data or exports.

## Verification

`--smoke-test` opens the actual embedded UI, waits for its JavaScript to render, creates an isolated test project, exports it, checks the snapshot script is present and downloads the archive. It writes `smoke-result.json` and `smoke.png` beside the executable without modifying real project data. The smoke check does not create, restore or build WSL distributions.
