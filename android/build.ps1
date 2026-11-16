param([string[]]$Tasks = @("testDebugUnitTest", "lintDebug", "assembleDebug"))
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$env:GRADLE_USER_HOME = Join-Path $PSScriptRoot ".cache/gradle"
$env:ANDROID_USER_HOME = Join-Path $PSScriptRoot ".cache/android"
$env:TEMP = $env:TMP = Join-Path $PSScriptRoot ".tmp"
New-Item -ItemType Directory -Force $env:GRADLE_USER_HOME,$env:ANDROID_USER_HOME,$env:TEMP | Out-Null
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME/bin/java.exe")) {
    throw "Set JAVA_HOME ke JDK 17+ (Gradle 9.3 mendukung JDK 25). Tidak perlu memasang Android Studio untuk build CLI."
}
& ./gradlew.bat @Tasks --no-daemon "-Djava.io.tmpdir=$env:TEMP"
exit $LASTEXITCODE
