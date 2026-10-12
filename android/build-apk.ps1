# Builds the Macros Android shell (a Trusted Web Activity) and copies the APK to the
# project root, where Vellichor's publish.ps1 can pick it up.
#
#   powershell -ExecutionPolicy Bypass -File ./android/build-apk.ps1
#
# Debug-signed with ~/.android/debug.keystore. That key's SHA-256 is in
# https://mailadisin-hub.github.io/.well-known/assetlinks.json - sign with any
# other key and the app shows Chrome's address bar instead of running full screen.
#
# App changes need NO rebuild: the APK just opens the live site. Rebuild only to
# change the icon, name or URL, and bump versionCode in app/build.gradle.kts.
#
# Plain ASCII on purpose: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr" }

$gradle = Get-Content (Join-Path $root "app\build.gradle.kts") -Raw
$version = [regex]::Match($gradle, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
if (-not $version) { throw "versionName not found" }

Push-Location $root
try {
    .\gradlew.bat :app:assembleDebug --console=plain
    if ($LASTEXITCODE -ne 0) { throw "gradle build failed" }
} finally { Pop-Location }

$out = Join-Path (Split-Path $root) "Macros-$version.apk"
Copy-Item (Join-Path $root "app\build\outputs\apk\debug\app-debug.apk") $out -Force
Write-Host "==> $out" -ForegroundColor Green
