<#
  HW5 Task 1: export the CDN configuration as files (a screenshot is not an export).

  1. In Cloudflare: My Profile > API Tokens > Create Token > template "Read all resources",
     limited to the zone miniexhibit.app. Copy the token (it is shown once).
  2. In PowerShell, set it for this window only (never commit it, never paste it into a file):
         $env:CF_API_TOKEN = "<paste token>"
  3. From the repository root:
         powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\export-cloudflare-config.ps1
  4. When finished, delete the token in Cloudflare (it is a credential).

  Writes hw5-rajapkar\evidence\01-cdn-config\{dns-zone.txt, cache-rules.json, zone-settings.json}.
  The token is sent only in the Authorization header to api.cloudflare.com and is never written.
#>
param([string]$Zone = "miniexhibit.app")
$ErrorActionPreference = "Stop"
if (-not $env:CF_API_TOKEN) { throw "Set `$env:CF_API_TOKEN first (see the comment at the top of this script)." }
$out = Join-Path $PSScriptRoot "..\evidence\01-cdn-config"
New-Item -ItemType Directory -Force $out | Out-Null
$headers = @{ Authorization = "Bearer $($env:CF_API_TOKEN)" }
$api = "https://api.cloudflare.com/client/v4"

$zoneId = (Invoke-RestMethod -Headers $headers -Uri "$api/zones?name=$Zone").result[0].id
if (-not $zoneId) { throw "Zone $Zone not found for this token" }

# DNS records as a BIND zone file (Cloudflare's own export format)
Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri "$api/zones/$zoneId/dns_records/export" -OutFile (Join-Path $out "dns-zone.txt")

# Cache Rules (the http_request_cache_settings ruleset)
$rules = Invoke-RestMethod -Headers $headers -Uri "$api/zones/$zoneId/rulesets/phases/http_request_cache_settings/entrypoint"
$rules.result | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 (Join-Path $out "cache-rules.json")

# The settings the cache and TLS behaviour depend on
$wanted = "ssl", "always_use_https", "min_tls_version", "brotli", "browser_cache_ttl", "cache_level", "automatic_https_rewrites", "http3", "development_mode", "always_online"
$settings = (Invoke-RestMethod -Headers $headers -Uri "$api/zones/$zoneId/settings").result |
  Where-Object { $wanted -contains $_.id } | Select-Object id, value, modified_on
$settings | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $out "zone-settings.json")

$utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
"Exported from the Cloudflare API at $utc for zone $Zone ($zoneId).`nToken: <REDACTED:cloudflare_api_token, read-only, deleted after export>" |
  Set-Content -Encoding utf8 (Join-Path $out "README.txt")
Write-Host "Exported to $out" -ForegroundColor Green
Get-ChildItem $out | ForEach-Object { Write-Host "  $($_.Name)  $($_.Length) bytes" }
