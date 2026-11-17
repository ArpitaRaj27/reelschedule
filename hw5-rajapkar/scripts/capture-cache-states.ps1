<#
  HW5 Tasks 1-3: edge proof, app-layer cache, and the four cache states, against the real domain.

  Run from the repository root in Windows PowerShell:
      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\capture-cache-states.ps1

  It writes (and overwrites) these files under hw5-rajapkar\evidence\:
      01-edge-proof.txt              DNS answers + headers: reel.miniexhibit.app (your Cloudflare) vs the onrender.com origin
      02-app-cache-miss-hit.txt      X-Cache MISS -> HIT -> (TTL expiry) -> MISS on /api/status
      03-headers\miss.txt            cold edge key        -> cf-cache-status: MISS
      03-headers\hit.txt             same key, 3 s later  -> HIT with Age
      03-headers\304.txt             If-None-Match with the captured ETag -> 304, 0 bytes
      03-headers\purge-before.txt    hashed asset served from the edge (HIT)
      03-headers\purge-after.txt     same asset after you purge it in Cloudflare (MISS)

  Every capture records the exact command and a UTC timestamp. The script sends no cookies or
  tokens, so nothing in these files needs redacting.
#>
param(
  [string]$Base = "https://reel.miniexhibit.app",
  [string]$Origin = "https://reelschedule-api-arpita.onrender.com"
)
$ErrorActionPreference = "Stop"
$evidence = Join-Path $PSScriptRoot "..\evidence"
$headersDir = Join-Path $evidence "03-headers"
New-Item -ItemType Directory -Force $headersDir | Out-Null
$timing = "`n# timing: dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download} status=%{http_code}`n"
$show = '^HTTP/|^server:|^cf-ray|^cf-cache-status|^age:|^x-cache|^etag|^cache-control|^cdn-cache-control|^content-encoding|^vary|# timing'

function Utc { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }

function Probe([string]$File, [string]$Label, [string]$Url, [string[]]$Extra = @()) {
  $curlArgs = @("-sS", "-o", "NUL", "-D", "-", "--max-time", "90", "-w", $timing) + $Extra + @($Url)
  $quoted = $curlArgs | ForEach-Object { if ($_ -match '[\s%"]') { "'" + $_ + "'" } else { $_ } }
  $utc = Utc
  $result = (& curl.exe @curlArgs 2>&1 | Out-String).Trim()
  Add-Content -Path $File -Encoding utf8 -Value ("# $Label`n# UTC: $utc`n# Command: curl.exe " + ($quoted -join " ") + "`n`n$result`n")
  Write-Host "`n---- $Label  ($utc)" -ForegroundColor Cyan
  ($result -split "`n") | Where-Object { $_ -match $show } | ForEach-Object { Write-Host "  $_" }
  return $result
}

function Header([string]$Raw, [string]$Name) {
  $line = ($Raw -split "`n") | Where-Object { $_ -match "^${Name}:" } | Select-Object -First 1
  if ($line) { return ($line -replace "^${Name}:\s*", "").Trim() } else { return "" }
}

function Fresh([string]$Path) { foreach ($f in $Path) { if (Test-Path $f) { Remove-Item $f } } }

# ---------------------------------------------------------------- 0. edge proof (Task 1)
$edgeFile = Join-Path $evidence "01-edge-proof.txt"; Fresh $edgeFile
$hostName = ([Uri]$Base).Host
$originHost = ([Uri]$Origin).Host
foreach ($h in @($hostName, $originHost)) {
  $dns = Resolve-DnsName $h -Type A -ErrorAction SilentlyContinue | Where-Object { $_.Type -eq "A" } | ForEach-Object { $_.IPAddress }
  $cname = Resolve-DnsName $h -ErrorAction SilentlyContinue | Where-Object { $_.Type -eq "CNAME" } | ForEach-Object { $_.NameHost }
  Add-Content -Path $edgeFile -Encoding utf8 -Value ("# DNS $h  (UTC $(Utc))`n# Command: Resolve-DnsName $h`nCNAME: " + ($cname -join ", ") + "`nA:     " + ($dns -join ", ") + "`n")
}
Add-Content -Path $edgeFile -Encoding utf8 -Value "# Name servers for the zone`n$((Resolve-DnsName ($hostName -replace '^[^.]+\.', '') -Type NS -ErrorAction SilentlyContinue | Where-Object { $_.Type -eq 'NS' } | ForEach-Object { $_.NameHost }) -join ', ')`n"
Probe $edgeFile "Through the custom domain (your Cloudflare zone)" "$Base/healthz" | Out-Null
Probe $edgeFile "Directly at the Render origin hostname (bypasses your zone)" "$Origin/healthz" | Out-Null

# ---------------------------------------------------------------- 1. app-layer cache (Task 2)
# A unique ?probe= value makes every request an edge MISS, so each one reaches the origin and
# the X-Cache header shows the APP cache's state. The app cache key ignores the query string.
$appFile = Join-Path $evidence "02-app-cache-miss-hit.txt"; Fresh $appFile
Write-Host "`nWaiting 11 s so the 10 s app-cache entry expires first..."
Start-Sleep -Seconds 11
function Bust { "$Base/api/status?probe=" + [guid]::NewGuid().ToString("N").Substring(0, 10) }
Probe $appFile "App cache 1: first read after expiry (expect X-Cache: MISS)" (Bust) | Out-Null
Probe $appFile "App cache 2: immediately again (expect X-Cache: HIT)" (Bust) | Out-Null
Start-Sleep -Seconds 11
Probe $appFile "App cache 3: after the 10 s TTL (expect X-Cache: MISS)" (Bust) | Out-Null
Add-Content -Path $appFile -Encoding utf8 -Value "# Note: production writes need sign-in (not configured until HW7), so this run shows TTL expiry.`n# Invalidation on write is proven by api/test/delivery.test.ts ('MISS -> HIT -> (write) -> MISS').`n"

# ---------------------------------------------------------------- 2. MISS, HIT + Age (Task 3)
$key = Bust
$missFile = Join-Path $headersDir "miss.txt"; Fresh $missFile
$hitFile = Join-Path $headersDir "hit.txt"; Fresh $hitFile
Probe $missFile "MISS: a cache key the edge has never seen" $key | Out-Null
Start-Sleep -Seconds 3
Probe $hitFile "HIT: the same key 3 s later (expect Age around 3)" $key | Out-Null

# ---------------------------------------------------------------- 3. 304 Not Modified
$file304 = Join-Path $headersDir "304.txt"; Fresh $file304
$listUrl = "$Base/api/screenings?probe=" + [guid]::NewGuid().ToString("N").Substring(0, 10)
$first = Probe $file304 "Step 1: capture the ETag" $listUrl
$etag = Header $first "etag"
if (-not $etag) { Write-Warning "No ETag captured; see $file304" }
Probe $file304 "Step 2: conditional request with that ETag (expect 304 and bytes=0)" $listUrl @("-H", "If-None-Match: $etag") | Out-Null

# ---------------------------------------------------------------- 4. invalidation by purge
$html = (& curl.exe -sS --max-time 90 "$Base/" | Out-String)
$asset = [regex]::Match($html, '/assets/index-[A-Za-z0-9_-]+\.js').Value
if (-not $asset) { throw "Could not find the main JS asset in the HTML" }
$before = Join-Path $headersDir "purge-before.txt"; Fresh $before
$after = Join-Path $headersDir "purge-after.txt"; Fresh $after
Probe $before "Before purge: warm the edge" "$Base$asset" | Out-Null
Probe $before "Before purge: served from the edge (expect HIT)" "$Base$asset" | Out-Null
Write-Host "`nNOW PURGE THIS URL in Cloudflare:" -ForegroundColor Yellow
Write-Host "  Caching > Configuration > Purge Cache > Custom Purge > URL:" -ForegroundColor Yellow
Write-Host "  $Base$asset" -ForegroundColor Yellow
Read-Host "Press Enter after Cloudflare says the purge succeeded"
Add-Content -Path $after -Encoding utf8 -Value "# Purged in the Cloudflare dashboard (Custom Purge, single URL $Base$asset) at about UTC $(Utc)`n"
Probe $after "After purge: same URL (expect MISS)" "$Base$asset" | Out-Null
Probe $after "After purge: again (expect HIT; the edge refilled from the origin)" "$Base$asset" | Out-Null

Write-Host "`nDone. Evidence written to $evidence" -ForegroundColor Green
