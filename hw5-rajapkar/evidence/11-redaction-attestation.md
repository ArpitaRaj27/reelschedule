# Redaction attestation (HW5)

✍️ Write this in your own words once all evidence is captured, e.g.:

> I attest that no artifact in this submission contains a usable secret, token, cookie value or authorization code. The capture scripts send no cookies or Authorization headers, so the header dumps contain none; the Cloudflare API token used for the configuration export was held only in a PowerShell environment variable, is shown as `<REDACTED:cloudflare_api_token>`, and was deleted after the export. I verified this by running: `<the command you ran>` and found no matches.

Suggested scan (PowerShell, from the repository root):

```powershell
Get-ChildItem hw5-rajapkar\evidence -Recurse -File |
  Select-String -Pattern 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}','Bearer [A-Za-z0-9._-]{20,}','Set-Cookie:','CF_API_TOKEN='
```
