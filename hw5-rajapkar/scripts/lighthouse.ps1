<#
  HW5 Task 5b: Lighthouse (performance only, mobile preset) against the deployed site.

      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\lighthouse.ps1 -Label before
      ...make one delivery improvement, deploy it...
      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\lighthouse.ps1 -Label after

  Needs Node.js and Google Chrome on this computer. Writes
  hw5-rajapkar\evidence\05-performance\lh-<label>.json and prints the headline metrics.
  Run it 3 times per label if the numbers jump around; keep the median run.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("before", "after")][string]$Label,
  [string]$Url = "https://reel.miniexhibit.app/"
)
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\evidence\05-performance"
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir "lh-$Label.json"

# Wake the free Render instance first so a cold start is not measured as page performance.
& curl.exe -sS -o NUL --max-time 120 "$Url" | Out-Null

npx --yes lighthouse@12 $Url --only-categories=performance --output=json --output-path="$out" --chrome-flags="--headless=new" --quiet
$r = Get-Content $out -Raw | ConvertFrom-Json
$a = $r.audits
"{0}  score={1}  LCP={2}  CLS={3}  TBT={4}  FCP={5}  (Lighthouse {6}, {7})" -f $Label,
  [math]::Round($r.categories.performance.score * 100),
  $a.'largest-contentful-paint'.displayValue, $a.'cumulative-layout-shift'.displayValue,
  $a.'total-blocking-time'.displayValue, $a.'first-contentful-paint'.displayValue,
  $r.lighthouseVersion, $r.fetchTime | Tee-Object -FilePath (Join-Path $dir "lh-$Label-summary.txt")
