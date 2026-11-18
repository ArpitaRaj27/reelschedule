<#
  HW5 Task 5c: save the RUM pilot summary from the live collector.

  First collect at least 6 sessions: open https://reel.miniexhibit.app on your laptop (and, if you
  can, your phone), CLICK something each time (INP only exists after an interaction), then switch
  tabs or close the tab so the metrics are sent. Then:
      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\rum-summary.ps1 -Since 2026-11-18T19:00:00Z
  -Since (UTC) limits the summary to the pilot window, so page views from before it (testing while
  building) are left out. Lighthouse, headless and automated browsers never send beacons (rum.ts).
  Writes hw5-rajapkar\evidence\05-performance\rum-summary.json (p75 per cohort and metric, with n).
#>
param(
  [string]$Base = "https://reel.miniexhibit.app",
  [string]$Since = ""
)
$dir = Join-Path $PSScriptRoot "..\evidence\05-performance"
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir "rum-summary.json"
$url = "$Base/api/vitals/summary"
if ($Since) { $url += "?since=$Since" }
& curl.exe -sS --max-time 120 "$url" -o $out
$summary = Get-Content $out -Raw | ConvertFrom-Json
$summary.rows | Format-Table cohort, name, n, pageViews, p75
Write-Host "Window: since $(if ($summary.since) { $summary.since } else { 'the beginning' })"
Write-Host "Saved $out from $url (UTC $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')))"
