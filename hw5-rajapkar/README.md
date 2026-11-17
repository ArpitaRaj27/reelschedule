# HW5 — Own the Edge (ReelSchedule)

**Arpita Rajapkar · CSC 436 · Gate 3 (Delivered and observable) for the final project**

| | |
|---|---|
| Deployment | https://reel.miniexhibit.app (Cloudflare Free in front of Render) |
| Origin | `reelschedule-api-arpita.onrender.com` (Render free web service, Ohio). It serves the React build **and** `/api` from one origin |
| Commit tested | `TODO: commit SHA` (`git rev-parse --short HEAD`, or the `commit` field of `/healthz`) |
| Tag | `TODO: hw5-submission` |

> **How to read this file.** Sections marked ✍️ must be written in your own words (course rule: "annotated interpretation in your own words"). Everything else is configuration fact you can check against the code and the evidence files. The AI-use log (`evidence/10-ai-use-log.md`) records which parts were drafted with AI help.

## Evidence index

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | CDN in front, TLS intact, vendor headers, config exported | `evidence/01-edge-proof.txt`, `evidence/01-cdn-config/` | capture: `capture-cache-states.ps1`, `export-cloudflare-config.ps1` |
| 2 | Cache-policy matrix + one app cache (MISS → HIT → MISS) | [matrix below](#cache-policy-matrix), `evidence/02-app-cache-miss-hit.txt` | capture: `capture-cache-states.ps1` |
| 3 | Four cache states | `evidence/03-headers/{miss,hit,304,purge-before,purge-after}.txt` | capture: `capture-cache-states.ps1` |
| 4 | Compression | `evidence/04-compression.txt` | capture: `compression.ps1` |
| 5 | Budget, Lighthouse before/after, RUM pilot, k6 | `evidence/05-performance/` | `lighthouse.ps1`, `rum-summary.ps1`, `load-test.ps1` |
| 6 | Asset-size report + one byte-budget decision | `evidence/06-bundle/` | TODO |
| 7 | axe (incl. one stateful view) + keyboard walkthrough + scanner-missed defect | `evidence/07-accessibility/` | TODO (the recording must be you) |
| 8 | Cross-user cache disclosure (loopback lab), cleanup, detection | `evidence/08-disclosure/` | TODO |
| 9 | SLI, SLO, error budget, alert that fired | `evidence/09-observability/` | TODO |
| — | AI-use log, challenged claim, redaction attestation | `evidence/10-ai-use-log.md`, `evidence/11-redaction-attestation.md` | template |

## Reproduce

From the repository root in Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\capture-cache-states.ps1   # Tasks 1-3 (asks you to purge one URL)
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\compression.ps1            # Task 4
$env:CF_API_TOKEN = "<read-only token>"                                                  # Task 1 export (never commit)
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\export-cloudflare-config.ps1
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\lighthouse.ps1 -Label before
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\rum-summary.ps1
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\load-test.ps1              # needs k6
```

Automated checks of the same policy (run in CI on every push): `npm test` → `api/test/delivery.test.ts` (headers per content class, app cache MISS → HIT → write → MISS, `/api/now`, RUM collector).

## Task 1 — CDN in front of the domain

- **DNS:** `miniexhibit.app` moved from Porkbun's nameservers to Cloudflare's (`oswald.ns.cloudflare.com`, `tina.ns.cloudflare.com`). `reel` is a **proxied** CNAME to `reelschedule-api-arpita.onrender.com`. It was DNS-only until Render issued its certificate for `reel.miniexhibit.app`, then switched to proxied, as Render's Cloudflare guide requires. The course TXT record `CSC436-2026FALL-…` was carried over.
- **TLS:** Cloudflare SSL/TLS mode **Full (strict)**. Browser → Cloudflare uses Cloudflare's edge certificate; Cloudflare → Render uses Render's certificate for `reel.miniexhibit.app`, and Cloudflare verifies it. `.app` is HSTS-preloaded, so HTTP is never an option for browsers.
- **Eligibility (decision a):** Cache Rule *"reel: HTML + public API eligible, respect origin TTL"*:
  ```
  (http.host eq "reel.miniexhibit.app"
   and not starts_with(http.request.uri.path, "/api/events")
   and not starts_with(http.request.uri.path, "/api/vitals")
   and not starts_with(http.request.uri.path, "/healthz"))
  → Eligible for cache; Edge TTL: use cache-control header if present, bypass cache if not
  ```
  Without the rule, Cloudflare caches only static file extensions, so HTML and `/api/*` show `DYNAMIC`.
- **Key composition (decision b):** Cloudflare's default key, i.e. the full URL including the query string. Cookies and `Authorization` are not in the key.
- **Origin directives (decision c):** the edge TTL comes from the origin. Cloudflare reads `CDN-Cache-Control` ahead of `Cache-Control`, so the origin can give the edge and browsers different TTLs.

**Observation worth explaining (✍️):** before the zone was proxied, responses *already* carried `server: cloudflare` and `cf-cache-status: DYNAMIC`. Render's own edge runs on Cloudflare. `01-edge-proof.txt` compares DNS answers and headers for the custom domain and the raw origin hostname; correlate them instead of trusting one header.

## Cache-policy matrix

Configuration columns are taken from the code (`api/src/webApp.ts`, `api/src/app.ts`) and the Cloudflare rule above. **The rationale column is yours to write ✍️.** Each cell lists the facts and numbers to use; turn them into 2–4 sentences: the number, what you trade away, who accepted it (for a fictional festival, "I, as product owner" is honest), and what would make it wrong.

| Content class | Example URL | Layer(s) | Configuration | Cache key | Invalidation | Rationale ✍️ (facts to use) |
|---|---|---|---|---|---|---|
| HTML shell | `/`, `/grid?date=…` | Browser (revalidate), CDN 30 s | `Cache-Control: public, max-age=0, must-revalidate` · `CDN-Cache-Control: max-age=30` · strict CSP | full URL | TTL 30 s; purge `/` on deploy if needed | The shell names the hashed assets, so a stale shell after a deploy points at assets that may be gone → 30 s bounds that. Observed: Cloudflare strips the shell's ETag, so a browser revalidation re-downloads it (see challenged claim) |
| Hashed assets | `/assets/index-CERyDSi4.js` | Browser + CDN, 1 year | `public, max-age=31536000, immutable` | full URL (the hash is in the name) | never purged: a new build = new filename | Content can't change under a name; a missing asset returns a JSON 404, never HTML |
| Unhashed static | `/favicon.svg` | Browser + CDN, 1 h | `public, max-age=3600` | full URL | TTL | Rarely changes; 1 h of a stale icon costs nothing |
| Public API list | `/api/screenings?date=2026-11-21` | Browser (revalidate → 304), React Query (10 s in memory), CDN 10 s | `public, max-age=0, s-maxage=10` · `CDN-Cache-Control: max-age=10, stale-while-revalidate=20, stale-if-error=600` · weak ETag | full URL incl. `?v=<latest change id>` | TTL; live update bumps `v` → new key | Program changes only on programmer writes; live viewers jump to a new key at once, others see ≤10 s (+20 s stale) old data; `stale-if-error` keeps the program visible for 10 min if Render is down or asleep |
| Polled status (+ app cache) | `/api/status` | Browser (revalidate), CDN 10 s, **app cache 10 s** (in memory, single-flight) | as above + `X-Cache: HIT \| MISS` | edge: full URL · app: `status:v1` | edge TTL; app cache deleted on every schedule write and on every change event | Page polls every 30 s; a burst of edge misses reaches Postgres once per 10 s; write invalidation means the first read after a change is fresh |
| Volatile | `/api/now` | CDN 2 s only | `public, max-age=0` · `CDN-Cache-Control: max-age=2` | full URL | TTL | Body changes every request → no validator can ever match → every expiry is a full payload |
| Authenticated | `/api/me`, `/api/films/search`, writes | **none** | `Cache-Control: private, no-store` whenever `Authorization` is present | — | never stored | Planned for HW7 sign-in; acceptance test exists (`api.test.ts` "marks authenticated responses private, no-store"); the edge bypasses because the origin says `no-store` |
| Live stream | `/api/events` (SSE) | none | `no-store`; excluded by the cache rule | — | never stored | A cached event stream would replay one moment forever |
| Errors | any 4xx/5xx JSON | none | `no-store` | — | never stored | An error must not outlive its cause |

## Task 3 — Cache-state narrative ✍️

Use `evidence/03-headers/*`. Explain in your own words:
1. why the first request was `MISS` and the second `HIT`, and what `Age` means;
2. why the conditional request got `304` with 0 bytes, and which layer answered it (`cf-cache-status` on the 304);
3. why the purge flipped the asset from `HIT` back to `MISS`;
4. why a volatile-body endpoint (`/api/now`) can never be `REVALIDATED`.

## Task 4 — Compression ✍️
Table from `evidence/04-compression.txt`. Note which encoding was actually negotiated; Cloudflare may answer `zstd` or `br` regardless of the origin.

## Task 5 — Performance

**Budget (state it before optimizing):**

| Metric | Budget | Measured how |
|---|---|---|
| LCP | ≤ 2.5 s | Lighthouse mobile; RUM p75 |
| INP | ≤ 200 ms | RUM only (needs an interaction) |
| CLS | ≤ 0.1 | Lighthouse and RUM |
| JS transferred | ≤ 200 KB compressed | asset-size report / compression table |
| `/api/status` p95 TTFB | ≤ 500 ms | k6 `ttfb_api` |

- **Lighthouse:** `lh-before.json`, `lh-after.json`, delta table. *Candidate improvement:* the "Next up" box appears after the page renders and pushes the program down (a layout shift). Measure it first, then decide.
- **RUM pilot:** `rum-summary.json` from `/api/vitals/summary`. Report desktop and mobile separately with `n`, and say that a p75 from about 6 samples is unstable. Write the sentence: *we have no CrUX data because the origin is below Chrome's reporting threshold.*
- **k6:** `k6-summary.txt`. The profile is the course file, unmodified (sha256 recorded). It ran against **my own production** because ReelSchedule has no separate staging yet.

## Tasks 6–9 — TODO
To be filled after those captures.

## Challenged AI claim ✍️

Candidate (verify it yourself before using it): the AI-written README says the HTML shell is "revalidated every time (cheap 304 via ETag)". Through Cloudflare, the shell arrives **without an ETag** (observed 2026-11-17: `etag: null`, `content-encoding: zstd`), so a browser revalidation downloads the whole shell. Evidence to capture: `curl.exe -sSI https://reel.miniexhibit.app/` (no ETag) vs `curl.exe -sSI https://reelschedule-api-arpita.onrender.com/` (ETag present). Then say what you changed or accepted.
