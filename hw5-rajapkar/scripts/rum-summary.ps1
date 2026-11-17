<#
  HW5 Task 5c: save the RUM pilot summary from the live collector.

  First collect at least 6 sessions: open https://reel.miniexhibit.app on your laptop (and, if you
  can, your phone), CLICK something each time (INP only exists after an interaction), then switch
  tabs or close the tab so the metrics are sent. Then:
      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\rum-summary.ps1
  Writes hw5-rajapkar\evidence\05-performance\rum-summary.json (p75 per cohort and metric, with n).
#>
param([string]$Base = "https://reel.miniexhibit.app")
$dir = Join-Path $PSScriptRoot "..\evidence\05-performance"
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir "rum-summary.json"
& curl.exe -sS --max-time 120 "$Base/api/vitals/summary" -o $out
Get-Content $out -Raw | ConvertFrom-Json | Select-Object -ExpandProperty rows | Format-Table cohort, name, n, pageViews, p75
Write-Host "Saved $out (UTC $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')))"
