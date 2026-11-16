param(
    [string]$Sdk = "$env:LOCALAPPDATA/Android/Sdk",
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$Serial = 'emulator-5560'
)
$ErrorActionPreference = 'Stop'
$android = Split-Path $PSScriptRoot -Parent
$work = Join-Path $android '.tmp/api30-time-check'
New-Item -ItemType Directory -Force $work | Out-Null
$env:TEMP = $work
$env:TMP = $work
$env:JAVA_HOME = $JavaHome
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=`"$work`""
@'
import java.time.Instant;
import java.time.OffsetDateTime;
public class Api30TimeCheck {
    public static void main(String[] args) {
        String[] values = {"2026-11-15T06:00:00Z", "2026-11-15T06:00:00+00:00"};
        for (String value : values) {
            try { System.out.println("Instant " + value + " => " + Instant.parse(value)); }
            catch (RuntimeException ex) { System.out.println("Instant " + value + " => " + ex.getClass().getSimpleName()); }
            Instant actual = OffsetDateTime.parse(value).toInstant();
            if (!actual.equals(Instant.parse("2026-11-15T06:00:00Z"))) throw new AssertionError(value);
            System.out.println("OffsetDateTime " + value + " => " + actual);
        }
    }
}
'@ | Set-Content (Join-Path $work 'Api30TimeCheck.java')
& "$JavaHome/bin/javac.exe" --release 8 -d $work "$work/Api30TimeCheck.java"
if ($LASTEXITCODE) { throw 'javac failed' }
$d8 = Get-ChildItem "$Sdk/build-tools/*/d8.bat" | Sort-Object FullName | Select-Object -Last 1
& $d8.FullName --min-api 26 --output "$work/probe.zip" "$work/Api30TimeCheck.class"
if ($LASTEXITCODE) { throw 'd8 failed' }
$adb = "$Sdk/platform-tools/adb.exe"
$api = (& $adb -s $Serial shell getprop ro.build.version.sdk).Trim()
if ($api -ne '30') { throw "Expected API 30, got $api" }
Write-Output "Android API $api"
& $adb -s $Serial push "$work/probe.zip" /data/local/tmp/api30-time-check.zip
if ($LASTEXITCODE) { throw 'adb push failed' }
& $adb -s $Serial shell dalvikvm -cp /data/local/tmp/api30-time-check.zip Api30TimeCheck | Tee-Object "$work/result.txt"
if ($LASTEXITCODE) { throw 'runtime check failed' }

