# Redaction attestation (HW5)

**My attestation:**

- The capture scripts do not send any of my cookies or `Authorization` headers.
- The production cache test was done with made-up tokens, and its output includes labels, not token values.
- `sid-alice` / `sid-bob` are the dummy users of the course lab on 127.0.0.1, visible by design.
- `alert-email.png` is cropped to the alert message.
- The Cloudflare export was done through my signed-in dashboard, without an API token (AI-use log, row 15).
- The full-history search (facts below) found no live secret.

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
