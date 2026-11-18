<#
  HW5 Task 6: what the production build's assets cost on the wire, and what the largest JS file is made of.

  Run from the repository root (needs only Node.js and curl.exe, no npm install):
      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\asset-size.ps1

  The build's own size table is Render's build log for the deployed commit (saved next to this report as
  render-build-log-<commit>.txt). This script adds what production actually sends:
  1. which commit is live (/healthz) and which hashed JS/CSS files its HTML references;
  2. bytes on the wire for each of them under br, gzip and identity (curl does not decode);
  3. whether the JS points at a source map and whether anyone can download that map;
  4. the largest JS file broken down by npm package (scripts\bundle-composition.mjs, no packages needed),
     from the files downloaded from production into a temporary folder (not committed).
  Writes hw5-rajapkar\evidence\06-bundle\asset-size-report-<live commit>.txt, so a run after a change
  does not overwrite the run before it.
#>
param([string]$Base = "https://reel.miniexhibit.app")
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\evidence\06-bundle"
New-Item -ItemType Directory -Force $dir | Out-Null
$tmp = Join-Path $env:TEMP "hw5-bundle"
New-Item -ItemType Directory -Force $tmp | Out-Null

$utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$healthz = (& curl.exe -sS --max-time 90 "$Base/healthz" | Out-String).Trim()
$live = [regex]::Match($healthz, '"commit":"([0-9a-f]{7})').Groups[1].Value
if (-not $live) { $live = "unknown" }
$out = Join-Path $dir "asset-size-report-$live.txt"
$html = (& curl.exe -sS --max-time 90 "$Base/" | Out-String)
$assets = @([regex]::Matches($html, '/assets/[A-Za-z0-9_.-]+\.(?:js|css)') | ForEach-Object { $_.Value } | Sort-Object -Unique)
if (-not $assets) { throw "No /assets/*.js or *.css found in $Base/" }
$lines = @("# HW5 Task 6 asset-size report, $utc", "production /healthz: $healthz", "HTML at $Base/ references: $($assets -join ', ')")

# 2. Bytes on the wire.
$lines += "", "## Bytes on the wire from production (curl, no decoding)"
foreach ($a in $assets) {
  foreach ($enc in @("br", "gzip", "identity")) {
    $raw = (& curl.exe -sS -o NUL -D - -H "Accept-Encoding: $enc" -w "`n__SIZE__%{size_download}" "$Base$a" | Out-String)
    $size = [int]([regex]::Match($raw, '__SIZE__(\d+)').Groups[1].Value)
    $status = [regex]::Match($raw, '^HTTP/\S+\s+(\d+)').Groups[1].Value
    $negotiated = [regex]::Match($raw, '(?im)^content-encoding:\s*(\S+)').Groups[1].Value
    if (-not $negotiated) { $negotiated = "none" }
    $cache = [regex]::Match($raw, '(?im)^cf-cache-status:\s*(\S+)').Groups[1].Value
    $lines += "{0,-30} asked={1,-8} got={2,-5} status={3} bytes={4,8} cf-cache-status={5}" -f $a, $enc, $negotiated, $status, $size, $cache
  }
}

# 3. Source map.
$mainJs = $assets | Where-Object { $_ -like "*.js" } | Select-Object -First 1
$jsFile = Join-Path $tmp ([IO.Path]::GetFileName($mainJs))
# Downloads ask for identity (uncompressed) so no decoding is needed; Windows' curl.exe may lack --compressed.
& curl.exe -sS -H "Accept-Encoding: identity" -o "$jsFile" "$Base$mainJs"
$mapRaw = (& curl.exe -sS -H "Accept-Encoding: identity" -o "$jsFile.map" -D - -w "`n__SIZE__%{size_download}" "$Base$mainJs.map" | Out-String)
$mapStatus = [regex]::Match($mapRaw, '^HTTP/\S+\s+(\d+)').Groups[1].Value
$mapBytes = [int]([regex]::Match($mapRaw, '__SIZE__(\d+)').Groups[1].Value)
$mapType = [regex]::Match($mapRaw, '(?im)^content-type:\s*([^\r\n]+)').Groups[1].Value
$mapCache = [regex]::Match($mapRaw, '(?im)^cf-cache-status:\s*(\S+)').Groups[1].Value
$mapBrRaw = (& curl.exe -sS -o NUL -D - -H "Accept-Encoding: br" -w "`n__SIZE__%{size_download}" "$Base$mainJs.map" | Out-String)
$mapBr = [int]([regex]::Match($mapBrRaw, '__SIZE__(\d+)').Groups[1].Value)
$mapBrEnc = [regex]::Match($mapBrRaw, '(?im)^content-encoding:\s*(\S+)').Groups[1].Value
$jsText = [IO.File]::ReadAllText($jsFile)
$comment = [regex]::Match($jsText, 'sourceMappingURL=(\S+)\s*$').Groups[1].Value
$lines += "", "## Source map"
$lines += "$mainJs is $([IO.File]::ReadAllBytes($jsFile).Length) bytes uncompressed; its last line names a source map: $(if ($comment) { $comment } else { '(none)' })"
$lines += "GET $Base$mainJs.map (identity) -> status $mapStatus, content-type $mapType, $mapBytes bytes, cf-cache-status $mapCache"
$lines += "GET $Base$mainJs.map (br)       -> $mapBr bytes on the wire, content-encoding $(if ($mapBrEnc) { $mapBrEnc } else { 'none' })"

# 4. Composition.
$lines += "", "## What $mainJs is made of (minified bytes, by npm package)"
if ($mapStatus -eq "200") {
  $comp = (& node (Join-Path $PSScriptRoot "bundle-composition.mjs") "$jsFile" | Out-String)
  $lines += $comp.Trim()
} else {
  $lines += "(skipped: production serves no source map. To analyse the bundle, build one locally that the JS does not link to:"
  $lines += " npm ci; npm run build -w web -- --sourcemap hidden; node hw5-rajapkar\scripts\bundle-composition.mjs web\dist\assets\<index-*.js>)"
}

$lines | Set-Content -Encoding utf8 -Path $out
$lines | ForEach-Object { Write-Host $_ }
Write-Host "`nWritten to $out" -ForegroundColor Green
