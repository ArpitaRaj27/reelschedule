<#
  HW5 Task 5b: Lighthouse (performance only, mobile preset) against the deployed site.

      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\lighthouse.ps1 -Label before
      ...make one delivery improvement, deploy it...
      powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\lighthouse.ps1 -Label after

  Needs Node.js and Google Chrome on this computer. Runs Lighthouse $Runs times (default 3), because
  one run against a free origin is noisy, and keeps the run with the median LCP as
  hw5-rajapkar\evidence\05-performance\lh-<label>.json. Every run is kept as lh-<label>-run<N>.json,
  and the per-run numbers go to lh-<label>-summary.txt.
  Lighthouse's user agent contains "Chrome-Lighthouse", so the site's RUM code sends no beacons.

  -Throttling devtools really slows the network and CPU instead of simulating it afterwards. Use it to see
  layout shifts that depend on request timing (data arriving after the first paint): the default
  simulated run loads at full speed, so the data usually beats the first paint and those shifts never happen.
  Files then get a -devtools suffix: lh-<label>-devtools.json, lh-<label>-devtools-summary.txt.

  A run that Lighthouse fails to record (runtimeError, e.g. NO_NAVSTART) is repeated, up to -MaxAttempts
  times (default 3), and each repeat is noted in the summary.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("before", "after")][string]$Label,
  [string]$Url = "https://reel.miniexhibit.app/",
  [int]$Runs = 3,
  [ValidateSet("simulate", "devtools")][string]$Throttling = "simulate",
  [int]$MaxAttempts = 3
)
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\evidence\05-performance"
New-Item -ItemType Directory -Force $dir | Out-Null
$name = if ($Throttling -eq "devtools") { "lh-$Label-devtools" } else { "lh-$Label" }

# Wake the free Render instance first so a cold start is not measured as page performance.
& curl.exe -sS -o NUL --max-time 120 "$Url" | Out-Null

$results = @()
$notes = @()
for ($i = 1; $i -le $Runs; $i++) {
  $path = Join-Path $dir "$name-run$i.json"
  $attempt = 0
  while ($true) {
    $attempt++
    if (Test-Path $path) { Remove-Item $path }
    Write-Host "Lighthouse run $i of $Runs (attempt $attempt of $MaxAttempts)..." -ForegroundColor Cyan
    npx --yes lighthouse@12 $Url --only-categories=performance --output=json --output-path="$path" --throttling-method=$Throttling --chrome-flags="--headless=new" --quiet
    # On Windows, Lighthouse can exit non-zero while deleting Chrome's temporary profile even though
    # the report was written, so the report file is the success test.
    $err = $null
    if (-not (Test-Path $path)) { $err = "wrote no report (exit code $LASTEXITCODE)" }
    else {
      $r = Get-Content $path -Raw | ConvertFrom-Json
      if ($r.runtimeError) { $err = "$($r.runtimeError.code): $($r.runtimeError.message)" }
    }
    if (-not $err) { break }
    # A run that failed to record (for example NO_NAVSTART, a trace Chrome did not capture) has no
    # numbers at all, so it is repeated rather than counted. Every retry is listed in the summary.
    $notes += "note: run $i attempt $attempt failed and was repeated: $err"
    if ($attempt -ge $MaxAttempts) { throw "Lighthouse run $i failed $attempt times; last error: $err" }
    Write-Host "  Run $i attempt $attempt failed ($err). Trying again." -ForegroundColor Yellow
  }
  $a = $r.audits
  $results += [pscustomobject]@{
    Run = $i; Path = $path
    Score = [math]::Round($r.categories.performance.score * 100)
    LcpMs = [math]::Round($a.'largest-contentful-paint'.numericValue)
    Cls = [math]::Round($a.'cumulative-layout-shift'.numericValue, 3)
    TbtMs = [math]::Round($a.'total-blocking-time'.numericValue)
    FcpMs = [math]::Round($a.'first-contentful-paint'.numericValue)
    SiMs = [math]::Round($a.'speed-index'.numericValue)
    Version = $r.lighthouseVersion; FetchTime = $r.fetchTime
  }
}

$sorted = @($results | Sort-Object LcpMs)
$median = $sorted[[math]::Floor(($sorted.Count - 1) / 2)]
Copy-Item $median.Path (Join-Path $dir "$name.json") -Force

$lines = @("# Lighthouse $($median.Version), mobile preset, throttling=$Throttling, performance only: $Url")
$lines += $results | ForEach-Object {
  "run {0}: score={1}  LCP={2} ms  CLS={3}  TBT={4} ms  FCP={5} ms  SI={6} ms  ({7})" -f $_.Run, $_.Score, $_.LcpMs, $_.Cls, $_.TbtMs, $_.FcpMs, $_.SiMs, $_.FetchTime
}
$lines += $notes
$lines += "median by LCP: run $($median.Run) -> $name.json"
# Set-Content -Encoding utf8, not Tee-Object: Windows PowerShell 5.1's Tee-Object writes UTF-16.
$lines | Set-Content -Encoding utf8 -Path (Join-Path $dir "$name-summary.txt")
$lines | ForEach-Object { Write-Host $_ }
