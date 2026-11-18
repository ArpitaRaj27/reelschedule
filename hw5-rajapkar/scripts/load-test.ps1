<#
  HW5 Task 5d: the course-standard k6 workload, unmodified (campuspulse-load-profile.js is the
  course file copied byte-for-byte; sha256 2f08087e7a86bff20ea9a582deefec6457fa59d97545887725a8368f7c9e772a).

  Install k6 once:   winget install k6 --source winget     (then open a NEW terminal so k6 is on PATH)
  Run:               powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\load-test.ps1

  Target: reel.miniexhibit.app is MY OWN deployment (ReelSchedule has no separate staging yet;
  say so in the write-up). Never point this at anything you do not own.

  The profile's own handleSummary() writes k6-summary.txt and k6-summary.json into the folder k6 runs
  in, so k6 runs inside hw5-rajapkar\evidence\05-performance. This script adds:
    k6-run.txt          when, which commit, the profile's sha256, the exact command, k6's console output
                        and the pass/fail result of each course threshold (read from k6-summary.json).
  Takes about 3 minutes (30 s ramp, 120 s hold, 30 s ramp-down; at most 10 virtual users).
#>
param([string]$Base = "https://reel.miniexhibit.app")
$ErrorActionPreference = "Stop"
$dir = Resolve-Path (Join-Path $PSScriptRoot "..\evidence\05-performance")
$k6Profile = Join-Path $PSScriptRoot "campuspulse-load-profile.js"
$expected = "2f08087e7a86bff20ea9a582deefec6457fa59d97545887725a8368f7c9e772a"
$hash = (Get-FileHash $k6Profile -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $expected) { throw "campuspulse-load-profile.js was modified (sha256 $hash); restore the course file first" }
if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) { throw "k6 is not installed or not on PATH: winget install k6 --source winget, then open a new terminal" }

$html = (& curl.exe -sS --max-time 120 "$Base/" | Out-String)   # also wakes a sleeping free instance
$asset = [regex]::Match($html, '/assets/index-[A-Za-z0-9_-]+\.js').Value
if (-not $asset) { throw "Could not find the main JS asset in the HTML" }
$healthz = (& curl.exe -sS --max-time 60 "$Base/healthz" | Out-String).Trim()
$k6Version = (& k6 version | Out-String).Trim()
$start = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$cmd = "k6 run --quiet --no-color -e BASE=$Base -e ASSET=$asset campuspulse-load-profile.js"
Write-Host "Running the course k6 profile against $Base for about 3 minutes..." -ForegroundColor Cyan

# cmd /c merges k6's stderr into stdout, so Windows PowerShell does not stop on k6's log lines.
Push-Location $dir
try {
  $output = (& cmd /c "k6 run --quiet --no-color -e BASE=$Base -e ASSET=$asset `"$k6Profile`" 2>&1" | Out-String)
  $exit = $LASTEXITCODE
} finally { Pop-Location }
$end = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# Threshold results from the profile's own summary data.
$thresholdLines = @()
$json = Join-Path $dir "k6-summary.json"
if (Test-Path $json) {
  $data = Get-Content $json -Raw | ConvertFrom-Json
  foreach ($metric in $data.metrics.PSObject.Properties) {
    $t = $metric.Value.thresholds
    if ($t) {
      foreach ($rule in $t.PSObject.Properties) {
        $thresholdLines += "{0,-32} {1,-12} {2}" -f $metric.Name, $rule.Name, $(if ($rule.Value.ok) { "PASS" } else { "FAIL" })
      }
    }
  }
}

$lines = @(
  "# k6 standard profile run",
  "start UTC:      $start",
  "end UTC:        $end",
  "target:         $Base (my own deployment; no separate staging)",
  "live commit:    $healthz",
  "asset:          $asset",
  "k6:             $k6Version",
  "profile sha256: $hash (matches the course file)",
  "command:        $cmd   (run in evidence\05-performance)",
  "k6 exit code:   $exit   (0 = all thresholds passed; 99 = at least one failed)",
  "",
  "## Course thresholds (from k6-summary.json)"
) + $thresholdLines + @("", "## k6 console output", $output.Trim())
$lines | Set-Content -Encoding utf8 (Join-Path $dir "k6-run.txt")
$lines | ForEach-Object { Write-Host $_ }
Write-Host "`nWritten: k6-run.txt, k6-summary.txt, k6-summary.json in $dir" -ForegroundColor Green
