<#
  HW5 Task 4: transfer size of the largest text asset under identity, gzip and br.

  Run from the repository root:
      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\compression.ps1
  Writes hw5-rajapkar\evidence\04-compression.txt.
#>
param([string]$Base = "https://reel.miniexhibit.app")
$ErrorActionPreference = "Stop"
$out = Join-Path $PSScriptRoot "..\evidence\04-compression.txt"
if (Test-Path $out) { Remove-Item $out }

$html = (& curl.exe -sS --max-time 90 "$Base/" | Out-String)
$asset = [regex]::Match($html, '/assets/index-[A-Za-z0-9_-]+\.js').Value
if (-not $asset) { throw "Could not find the main JS asset in the HTML" }
$url = "$Base$asset"
$utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
Add-Content -Path $out -Encoding utf8 -Value "# Largest text asset: $url`n# UTC: $utc`n"

$rows = @()
foreach ($enc in @("identity", "gzip", "br")) {
  $cmd = "curl.exe -sS -o NUL -D - -H 'Accept-Encoding: $enc' -w '%{size_download}' $url"
  $raw = (& curl.exe -sS -o NUL -D - -H "Accept-Encoding: $enc" -w "`n__SIZE__%{size_download}" $url | Out-String)
  $size = [int]([regex]::Match($raw, '__SIZE__(\d+)').Groups[1].Value)
  $negotiated = ([regex]::Match($raw, '(?im)^content-encoding:\s*(\S+)').Groups[1].Value)
  if (-not $negotiated) { $negotiated = "(none: identity)" }
  $cache = ([regex]::Match($raw, '(?im)^cf-cache-status:\s*(\S+)').Groups[1].Value)
  Add-Content -Path $out -Encoding utf8 -Value "# Command: $cmd`n$($raw -replace '__SIZE__\d+', '')`n"
  $rows += [pscustomobject]@{ Requested = $enc; Negotiated = $negotiated; Bytes = $size; CfCacheStatus = $cache }
}
$identity = ($rows | Where-Object Requested -eq "identity").Bytes
$table = $rows | ForEach-Object {
  $saved = if ($identity -gt 0) { [math]::Round(100 * (1 - $_.Bytes / $identity), 1) } else { 0 }
  "{0,-9} negotiated={1,-18} bytes={2,8}  saved={3,5}%  cf-cache-status={4}" -f $_.Requested, $_.Negotiated, $_.Bytes, $saved, $_.CfCacheStatus
}
Add-Content -Path $out -Encoding utf8 -Value ("# Summary`n" + ($table -join "`n"))
$table | ForEach-Object { Write-Host $_ }
Write-Host "`nWritten to $out" -ForegroundColor Green
