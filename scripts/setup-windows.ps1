# Cardly - development environment setup for a new Windows PC
#
# Run from the repository root (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
#
# What it does:
#   1. Installs Git, Node.js LTS, Eclipse Temurin JDK 21 with winget (skipped if already installed)
#   2. Installs Android SDK command-line tools + platform 36 + build-tools 35
#      (this accepts the Android SDK license on your behalf)
#   3. Sets JAVA_HOME / ANDROID_HOME (user environment variables)
#   4. Configures the app signing key from %USERPROFILE%\.cardly into %USERPROFILE%\.gradle\gradle.properties
#   5. Writes android\local.properties and runs npm install
#
# Options:
#   -SkipTools   only do steps 3-5 (tools already installed)
#
# NOTE: this file is ASCII-only on purpose. Windows PowerShell 5.1 misreads UTF-8 files without BOM.

param([switch]$SkipTools)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$cardlyDir = Join-Path $env:USERPROFILE '.cardly'

function Step($msg) { Write-Host ''; Write-Host "== $msg" -ForegroundColor Cyan }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

if (-not $SkipTools) {
  Step 'Installing Git, Node.js LTS, JDK 21 (winget)'
  foreach ($id in 'Git.Git', 'OpenJS.NodeJS.LTS', 'EclipseAdoptium.Temurin.21.JDK') {
    winget list --id $id -e --accept-source-agreements --disable-interactivity | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "  $id : already installed"; continue }
    Write-Host "  $id : installing (an administrator prompt may appear)"
    winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  }
  Refresh-Path

  Step 'Installing Android SDK command-line tools'
  $tools = Join-Path $sdk 'cmdline-tools\latest'
  if (Test-Path (Join-Path $tools 'bin')) {
    Write-Host '  already installed'
  } else {
    $xml = (Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-3.xml' -UseBasicParsing).Content
    $zipName = [regex]::Matches($xml, 'commandlinetools-win-(\d+)_latest\.zip') |
      Sort-Object { [long]$_.Groups[1].Value } | Select-Object -Last 1 | ForEach-Object { $_.Value }
    if (-not $zipName) { throw 'Could not find the Android command-line tools download.' }
    $zip = Join-Path $env:TEMP $zipName
    Write-Host "  downloading $zipName"
    Invoke-WebRequest "https://dl.google.com/android/repository/$zipName" -OutFile $zip -UseBasicParsing
    $tmp = Join-Path $env:TEMP 'cardly-cmdline-tools'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive $zip -DestinationPath $tmp
    New-Item -ItemType Directory -Force (Join-Path $sdk 'cmdline-tools') | Out-Null
    Move-Item (Join-Path $tmp 'cmdline-tools') $tools
  }

  Step 'Installing Android platform 36, build-tools 35, platform-tools (accepts Android SDK license)'
  $android = Join-Path $tools 'bin\android.exe'
  $yes = (1..20 | ForEach-Object { 'y' }) -join "`n"
  $yes | & $android --sdk=$sdk sdk install 'platform-tools' 'platforms/android-36' 'build-tools/35.0.0' 2>&1 |
    Where-Object { $_ -notmatch 'Unzipping|Downloading|UseAllWindowsProcessorGroups' } | Out-Host
}

Step 'Setting JAVA_HOME / ANDROID_HOME'
$jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk) { throw 'JDK 21 not found in C:\Program Files\Eclipse Adoptium. Run without -SkipTools first.' }
[Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk.FullName, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pt = Join-Path $sdk 'platform-tools'
if ($userPath -notlike "*$pt*") { [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ";$pt"), 'User') }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = $sdk
Write-Host "  JAVA_HOME    = $($jdk.FullName)"
Write-Host "  ANDROID_HOME = $sdk"

Step 'Configuring app signing key'
$props = Join-Path $cardlyDir 'signing.properties'
$jks = Join-Path $cardlyDir 'cardly-release.jks'
if ((Test-Path $props) -and (Test-Path $jks)) {
  # signing.properties holds CARDLY_* lines. Fix the keystore path for this PC's user folder.
  $lines = Get-Content $props | Where-Object { $_ -match '^CARDLY_' } | ForEach-Object {
    if ($_ -like 'CARDLY_STORE_FILE=*') { 'CARDLY_STORE_FILE=' + $jks.Replace('\', '/') } else { $_ }
  }
  $gp = Join-Path $env:USERPROFILE '.gradle\gradle.properties'
  New-Item -ItemType Directory -Force (Split-Path $gp) | Out-Null
  $keep = @()
  if (Test-Path $gp) { $keep = @(Get-Content $gp | Where-Object { $_ -notmatch '^CARDLY_' }) }
  [IO.File]::WriteAllLines($gp, [string[]](@($keep) + @($lines)))
  Write-Host "  OK: key settings written to $gp"
} else {
  Write-Warning "Signing key not found in $cardlyDir"
  Write-Warning 'Copy the .cardly folder (cardly-release.jks + signing.properties) from your other PC, then run:'
  Write-Warning '  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -SkipTools'
  Write-Warning 'Without it, APKs are signed with a temporary key: they cannot update the installed app and Google login fails.'
}

Step 'Writing android\local.properties'
$lp = Join-Path $repo 'android\local.properties'
[IO.File]::WriteAllText($lp, 'sdk.dir=' + $sdk.Replace('\', '\\') + "`r`n")
Write-Host "  sdk.dir = $sdk"

Step 'npm install'
Refresh-Path
$npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
if (-not (Test-Path $npm)) { $npm = 'npm' }
Push-Location $repo
try { & $npm install --no-fund --no-audit } finally { Pop-Location }

Step 'Done'
Write-Host 'Open a NEW terminal (so the environment variables apply), then build the app with:'
Write-Host '  npm run apk'
Write-Host 'The APK will be at android\app\build\outputs\apk\debug\app-debug.apk'
