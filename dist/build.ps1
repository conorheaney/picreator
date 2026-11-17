#Requires -Version 5.1
<#
.SYNOPSIS
Build the entire Pi Creator app as dist\PiCreator.exe (Windows x64).
.DESCRIPTION
Requires the .NET 10 SDK and Node.js 22+ x64 on the build machine. Node and .NET
are embedded in the output; users only need Windows and the WebView2 Runtime.
Run from any directory. No user data, exports, backups or WSL images are packaged.
.EXAMPLE
.\dist\build.ps1
.EXAMPLE
.\dist\build.ps1 -SmokeTest
Build and run the packaged app's isolated WebView/API/export smoke check.
#>
[CmdletBinding()]
param([switch]$SmokeTest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dist = $PSScriptRoot
$root = Split-Path -Parent $dist

# -----------------------------------------------------------------------------
# Check build tools and prepare an isolated payload directory
# -----------------------------------------------------------------------------

$node = (Get-Command node.exe -ErrorAction Stop).Source
Get-Command dotnet.exe -ErrorAction Stop | Out-Null
$nodeInfo = & $node -p 'JSON.stringify({version:process.versions.node,arch:process.arch})'
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Node.' }
$info = $nodeInfo | ConvertFrom-Json
if ($info.arch -ne 'x64' -or [int]$info.version.Split('.')[0] -lt 22) { throw 'Use Node.js 22+ x64 to build this Windows x64 package.' }
$buildRoot = Join-Path $dist '.build'
$stage = Join-Path $buildRoot ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# -----------------------------------------------------------------------------
# Stage only application inputs, never personal projects or generated outputs
# -----------------------------------------------------------------------------

foreach ($name in @('server.mjs', 'package.json', 'public', 'lib', 'templates', 'docs')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination $stage -Recurse
}
Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'node.exe')
# Node's license includes notices for its bundled third-party components.
$license = Join-Path $buildRoot ('node-' + $info.version + '-LICENSE.txt')
if (-not (Test-Path -LiteralPath $license)) {
    Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/nodejs/node/v' + $info.version + '/LICENSE') -OutFile $license
}
Copy-Item -LiteralPath $license -Destination (Join-Path $stage 'NODE-LICENSE.txt')
Copy-Item -LiteralPath $license -Destination (Join-Path $dist 'NODE-LICENSE.txt')

# -----------------------------------------------------------------------------
# Embed the app and Node; publish the C# host and .NET into one executable
# -----------------------------------------------------------------------------

Add-Type -AssemblyName System.IO.Compression.FileSystem
$payload = Join-Path $buildRoot 'payload.zip'
if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload)
$publish = Join-Path $buildRoot 'publish'
& dotnet.exe publish (Join-Path $dist 'desktop\PiCreator.csproj') -c Release -o $publish
if ($LASTEXITCODE -ne 0) { throw 'Desktop publish failed.' }
Copy-Item -LiteralPath (Join-Path $publish 'PiCreator.exe') -Destination (Join-Path $dist 'PiCreator.exe') -Force
$exe = Join-Path $dist 'PiCreator.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Publish did not produce PiCreator.exe.' }
Write-Host "Built: $exe"
Get-FileHash -LiteralPath $exe -Algorithm SHA256 | Format-List

# -----------------------------------------------------------------------------
# Optional smoke check: actual WebView rendering plus an isolated project export
# -----------------------------------------------------------------------------

if ($SmokeTest) {
    $report = Join-Path $dist 'smoke-result.json'
    if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report }
    $process = Start-Process -FilePath $exe -ArgumentList '--smoke-test' -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(60000)) { $process.Kill(); throw 'Packaged smoke check timed out.' }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw 'Packaged smoke check failed. See smoke-result.json or %LOCALAPPDATA%\PiCreator\startup-error.log.' }
    $result = Get-Content -Raw -LiteralPath $report | ConvertFrom-Json
    if (-not $result.ok) { throw 'Packaged smoke check reported a failure.' }
    Write-Host 'Packaged WebView, persistence, export and archive download passed.'
}
