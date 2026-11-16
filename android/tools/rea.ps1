param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ReaArgs)
$ErrorActionPreference = "Stop"
$androidRoot = Split-Path -Parent $PSScriptRoot
$env:REA_JADX_MCP_JAR = Join-Path $androidRoot ".cache/rea/jadx-0.7.1/jadx-headless-mcp-0.7.1-all.jar"
if (-not (Test-Path -LiteralPath $env:REA_JADX_MCP_JAR)) { throw "JAR JADX belum tersedia; lihat README bagian REA/JADX." }
if ((Get-FileHash -LiteralPath $env:REA_JADX_MCP_JAR -Algorithm SHA256).Hash -ne "6E5EACF500B64292BFB73C49797C1958F6EE44646E43E868039AE7FEB573FF75") { throw "Checksum JAR JADX tidak sesuai versi REA." }
$env:REA_JADX_HEAP_MIB = "1536"
$env:REA_JADX_ACTIVE_PROCESSOR_COUNT = "2"
$env:TEMP = $env:TMP = Join-Path $androidRoot ".tmp/rea"
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$env:npm_config_cache = Join-Path $androidRoot ".cache/npm"
$reaGlobalRoot = & npm.cmd root --global
if ($LASTEXITCODE) { throw "Tidak dapat menemukan paket REA global." }
$reaEntry = Join-Path $reaGlobalRoot "rea-agents/scripts/rea.mjs"
if (-not (Test-Path -LiteralPath $reaEntry)) { throw "Paket rea-agents belum terpasang global." }
& node $reaEntry @ReaArgs
exit $LASTEXITCODE
