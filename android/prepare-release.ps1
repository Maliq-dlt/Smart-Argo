$ErrorActionPreference = "Stop"
$privateDir = Join-Path $PSScriptRoot ".private"
$keyFile = Join-Path $privateDir "release.p12"
$configFile = Join-Path $privateDir "release.properties"
if ((Test-Path -LiteralPath $keyFile) -and (Test-Path -LiteralPath $configFile)) {
    Write-Output "Release signing already exists. Existing files were preserved."
    exit 0
}
if ((Test-Path -LiteralPath $keyFile) -or (Test-Path -LiteralPath $configFile)) {
    throw "Incomplete signing pair. Restore the matching keystore and properties from backup; nothing was overwritten."
}
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME/bin/keytool.exe")) {
    throw "Set JAVA_HOME to the JDK used by build.ps1 first."
}
New-Item -ItemType Directory -Force $privateDir | Out-Null
$random = [byte[]]::new(32)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$password = [Convert]::ToBase64String($random)
$previousPassword = $env:SMART_AGRO_RELEASE_PASSWORD
try {
    $env:SMART_AGRO_RELEASE_PASSWORD = $password
    # Write recovery material before creating the key. Never print either password.
    $properties = "storeFile=.private/release.p12`nstorePassword=$password`nkeyAlias=smartagrorelease`nkeyPassword=$password`n"
    [System.IO.File]::WriteAllText($configFile, $properties, [System.Text.UTF8Encoding]::new($false))
    & "$env:JAVA_HOME/bin/keytool.exe" -genkeypair -noprompt -storetype PKCS12 -keystore $keyFile `
        -storepass:env SMART_AGRO_RELEASE_PASSWORD -keypass:env SMART_AGRO_RELEASE_PASSWORD `
        -alias smartagrorelease -dname "CN=Smart Agro Android Release" -keyalg RSA -keysize 3072 -validity 10000
    if ($LASTEXITCODE -ne 0) { throw "Key generation failed. Recovery properties were preserved; inspect .private/ before retrying." }
} finally {
    $env:SMART_AGRO_RELEASE_PASSWORD = $previousPassword
    $password = $properties = $null
    [Array]::Clear($random, 0, $random.Length)
}
Write-Output "Release key created in android/.private/. Keep an encrypted backup of both files before distribution."
