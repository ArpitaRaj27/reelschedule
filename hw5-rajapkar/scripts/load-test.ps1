<#
  HW5 Task 5d: the course-standard k6 workload, unmodified (campuspulse-load-profile.js is the
  course file copied byte-for-byte; sha256 2f08087e7a86bff20ea9a582deefec6457fa59d97545887725a8368f7c9e772a).

  Install k6 once:   winget install k6 --source winget     (or: choco install k6)
  Run:               powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\load-test.ps1

  Target: reel.miniexhibit.app is MY OWN deployment (ReelSchedule has no separate staging yet;
  say so in the write-up). Never point this at anything you do not own.
  Writes hw5-rajapkar\evidence\05-performance\k6-summary.txt and k6-summary.json.
#>
param([string]$Base = "https://reel.miniexhibit.app")
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\evidence\05-performance"
New-Item -ItemType Directory -Force $dir | Out-Null

$html = (& curl.exe -sS --max-time 120 "$Base/" | Out-String)   # also wakes a sleeping free instance
$asset = [regex]::Match($html, '/assets/index-[A-Za-z0-9_-]+\.js').Value
if (-not $asset) { throw "Could not find the main JS asset in the HTML" }
$k6Profile = Join-Path $PSScriptRoot "campuspulse-load-profile.js"
$hash = (Get-FileHash $k6Profile -Algorithm SHA256).Hash.ToLower()
$utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$header = "# k6 standard profile, UTC $utc`n# profile sha256 $hash`n# Command: k6 run -e BASE=$Base -e ASSET=$asset --summary-export=k6-summary.json campuspulse-load-profile.js`n"
$header | Set-Content -Encoding utf8 (Join-Path $dir "k6-summary.txt")
$summaryJson = Join-Path $dir "k6-summary.json"
k6 run -e "BASE=$Base" -e "ASSET=$asset" "--summary-export=$summaryJson" $k6Profile 2>&1 |
  Tee-Object -Variable run | Out-Host
$run | Out-String | Add-Content -Encoding utf8 (Join-Path $dir "k6-summary.txt")
