# Redaction attestation (HW5)

✍️ Write this in your own words once all evidence is captured, e.g.:

> I attest that no artifact in this submission contains a usable secret, token, cookie value or authorization code. The capture scripts send no cookies or Authorization headers, so the header dumps contain none; the Cloudflare API token used for the configuration export was held only in a PowerShell environment variable, is shown as `<REDACTED:cloudflare_api_token>`, and was deleted after the export. I verified this by running: `<the command you ran>` and found no matches.

Suggested scan (PowerShell, from the repository root):

```powershell
Get-ChildItem hw5-rajapkar\evidence -Recurse -File |
  Select-String -Pattern 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}','Bearer [A-Za-z0-9._-]{20,}','Set-Cookie:','CF_API_TOKEN='
```

## Facts: full-history scan, 2026-11-25

Run by the AI assistant on my laptop over all 28 commits (`git log -p --all`), after the repository had been made public (2026-11-25, for the final submission):
- Files ever committed with secret-looking names: only `api/.env.example` (and its earlier copy under `reelschedule/api/`). Every version has `TMDB_READ_TOKEN=` empty and a local `postgres://postgres@localhost` URL with no password.
- Content patterns searched: JWTs, `Bearer` tokens of 40+ characters, GitHub tokens, Postgres URLs with a password, private keys, AWS and OpenAI-style keys, Slack tokens, `TMDB_READ_TOKEN=<value>`, `CF_API_TOKEN=<value>`, `Set-Cookie:`. Matches: the scan pattern quoted in this file, the `TMDB_READ_TOKEN` field of the config schema, and `postgres://postgres:postgres@localhost:5432/reelschedule_test` in `.github/workflows/ci.yml` (the throwaway database CI starts for the tests). No live secret.
- The production secrets (`DATABASE_URL`, `TMDB_READ_TOKEN`) exist only in Render's environment and in the env file uploaded to the instructor's private D2L folder.
