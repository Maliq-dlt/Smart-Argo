param([string]$Apk = (Join-Path (Split-Path $PSScriptRoot -Parent) "app/build/outputs/apk/debug/app-debug.apk"))
$ErrorActionPreference = "Stop"
$method = & "$PSScriptRoot/rea.ps1" inspect-android-method $Apk id.smartagro.app.ModelsKt instant --overload-index 0 --format json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $method.normalized_result.source.status -ne "complete" -or $method.normalized_result.source.text -notmatch 'OffsetDateTime\.parse') { throw "Compiled APK timestamp method could not be verified." }
# Catch Windows batch-shell interpretation of angle brackets in special JVM method names.
$initializer = & "$PSScriptRoot/rea.ps1" inspect-android-method $Apk id.smartagro.app.ModelsKt '<clinit>' --overload-index 0 --format json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $initializer.normalized_result.method.name -ne '<clinit>' -or $initializer.normalized_result.body_status -ne 'available') { throw "Special JVM method argument was not preserved." }
Write-Output "PASS: actual APK timestamp method and literal <clinit> decompile successfully."
