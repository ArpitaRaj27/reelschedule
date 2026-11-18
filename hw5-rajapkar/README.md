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
| 6 | Asset-size report + one byte-budget decision | `evidence/06-bundle/` | capture: Render build log, `asset-size.ps1` |
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
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\lighthouse.ps1 -Label before                          # and -Label after
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\lighthouse.ps1 -Label before -Throttling devtools     # real slowdown; shows the layout shift
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\rum-summary.ps1
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\load-test.ps1              # needs k6
powershell -ExecutionPolicy Bypass -File hw5-rajapkar\scripts\asset-size.ps1             # Task 6
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
- **Browser Cache TTL (found in run 1, fixed 2026-11-18):** the zone setting was on Cloudflare's default (4 hours), which raised the origin's `max-age=0` to `max-age=14400` on every response through the zone, so browsers could have reused API data for 4 hours. Set to **Respect Existing Headers**; run 2 shows the origin's `public, max-age=0, s-maxage=10` arriving unchanged. Before/after: `evidence/run1-2026-11-17-before-fixes/03-headers/miss.txt` vs `evidence/03-headers/miss.txt`.
- **Origin hostname vs region:** in `01-edge-proof.txt` the Render hostname resolves through `gcp-us-west1-1.origin.onrender.com`, but the Render dashboard lists the service region as **ohio** (checked 2026-11-18). Don't infer the origin's location from that CNAME name.

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

## Captures (facts)

| Run | When (UTC) | Deployed commit | Where | What it showed |
|---|---|---|---|---|
| 1 | 2026-11-17 19:58–20:04 | `8ae439e` | `evidence/run1-2026-11-17-before-fixes/` (see its `NOTES.md`) | 4 h Browser Cache TTL override; a 304 false negative caused by the script; purge before/after answered by different data centers (DFW, MAN) |
| 2 | 2026-11-18 17:57–18:03 | `8ae439e` | `evidence/01-edge-proof.txt`, `02-app-cache-miss-hit.txt`, `03-headers/` | all four states as designed (below) |

Run 2, for the narrative (the CF-RAY suffix is the Cloudflare data center that answered):

- **Edge MISS → HIT:** the same `/api/status?probe=…` key, both answered at `-CMH`; the HIT carries `Age: 3`.
- **App cache:** `X-Cache` went MISS → HIT → (after 11 s) MISS while `cf-cache-status` stayed MISS on every request (each request used a new `?probe=` key, so each one reached the origin). In `03-headers/miss.txt` the edge says MISS while the app says HIT: the two layers are independent.
- **304:** step 1 got `200`, 4871 bytes (MISS at `-ATL`); step 2 sent the saved ETag and got `304 Not Modified`, 0 bytes, with `cf-cache-status: MISS` at `-CMH`.
- **Purge:** warm request MISS, then HIT (`Age: 0`) at `-CMH`; single-URL purge at 18:03:13; the next request was a **MISS at `-CMH`** (the same data center), so the purge removed that copy. The request after it was routed to `-ARN`, whose cache had never held the file, so it was also a MISS. No refill HIT was captured, and none is needed for the proof.

## Task 3 — Cache-state narrative ✍️

Use `evidence/03-headers/*`. Explain in your own words:
1. why the first request was `MISS` and the second `HIT`, and what `Age` means;
2. why the conditional request got `304` with 0 bytes, and which layer answered it (`cf-cache-status` on the 304);
3. why the purge flipped the asset from `HIT` back to `MISS`;
4. why a volatile-body endpoint (`/api/now`) can never be `REVALIDATED`.

## Task 4 — Compression

Largest text asset: `/assets/index-CERyDSi4.js`, captured 2026-11-18 18:09 UTC by `scripts/compression.ps1` (`evidence/04-compression.txt`). Bytes are the bytes on the wire: curl ran without `--compressed`, so it did not decode.

| Requested `Accept-Encoding` | Negotiated `Content-Encoding` | Bytes | Saved vs identity | `cf-cache-status` (Age) |
|---|---|---:|---:|---|
| identity | none | 352,290 | — | MISS |
| gzip | gzip | 107,907 | 69.4% | HIT (1) |
| br | br | 109,286 | 69.0% | HIT (2) |
| zstd | zstd | 112,305 | 68.1% | HIT (3) |

Facts to interpret ✍️:
- Every encoding asked for was honored; there was no silent fallback to identity.
- **Brotli came out 1,379 bytes (1.3%) larger than gzip**, and zstd 4,398 bytes (4.1%) larger. On a static asset, brotli at a high quality level usually beats gzip.
- The identity request filled the cache (MISS); the gzip, br and zstd requests were HITs with `Age` 1, 2, 3, all from the same data center. One cached copy served all four encodings.
- Possible explanation (a hypothesis, not verified): Cloudflare compresses on the fly at a fast, low quality level. The Free plan has no setting that shows this. If you use it, label it as a hypothesis, like the course's own example.
- All four requests were answered at `-NRT` (Tokyo) although the client is in Chicago. Earlier runs also landed at ARN and MAN. Note this as a fact; don't explain it unless you have a source.
- Against the budget: 108 KB of JavaScript compressed (gzip) is under the 200 KB compressed budget in Task 5.

## Task 5 — Performance

**Budget (state it before optimizing):**

| Metric | Budget | Measured how |
|---|---|---|
| LCP | ≤ 2.5 s | Lighthouse mobile; RUM p75 |
| INP | ≤ 200 ms | RUM only (needs an interaction) |
| CLS | ≤ 0.1 | Lighthouse and RUM |
| JS transferred | ≤ 200 KB compressed | asset-size report / compression table |
| `/api/status` p95 TTFB | ≤ 500 ms | k6 `ttfb_api` |

### Lighthouse (facts)

Lighthouse 12.8.2, mobile preset, performance category only, run from my laptop with `scripts/lighthouse.ps1` against https://reel.miniexhibit.app/. Each row is 3 runs. The run with the median LCP is kept as the `.json` without a run number, and every run's numbers are in the `*-summary.txt` next to it. Two throttling modes:

- **simulated** (Lighthouse's default): the page loads at full speed, and Lighthouse estimates slow-4G timings afterwards.
- **devtools** (`-Throttling devtools`): Chrome really slows the network and CPU while the page loads.

| Row | Deployed commit | Mode | Scores (runs 1/2/3) | LCP ms (runs) | CLS (runs) | Median run: score · LCP · CLS · TBT | File in `evidence/05-performance/` |
|---|---|---|---|---|---|---|---|
| before | `2411639` | simulated | 96 / 94 / 90 | 1539 / 2110 / 2964 | 0.011 / 0 / 0 | 94 · 2110 · 0 · 205 | `lh-before.json` |
| before | `2411639` | devtools | 76 / 62 / 38 | 2817 / 5266 / 5419 | 0.146 / 0.147 / 0.146 | 62 · 5266 · 0.147 · 197 | `lh-before-devtools.json` |
| after, first try (fix + preload) | `ed7f1e5` | simulated | 86 / 92 / 90 | 3062 / 2715 / 2913 | 0.011 / 0 / 0 | 90 · 2913 · 0 · 159 | `after-with-preload-ed7f1e5/lh-after.json` |
| after, first try (fix + preload) | `ed7f1e5` | devtools | 88 / 80 / 61 | 2909 / 2805 / 4976 | 0.021 / 0.021 / 0.021 | 88 · 2909 · 0.021 · 150 | `after-with-preload-ed7f1e5/lh-after-devtools.json` |
| **after (final)** | `c1dc15c` | simulated | 88 / 93 / 92 | 2642 / 2166 / 2470 | 0.021 / 0 / 0.019 | 92 · 2470 · 0.019 · 190 | `lh-after.json` |
| **after (final)** | `c1dc15c` | devtools | 82 / 69 / 83 | 2967 / 3785 / 2725 | 0.021 / 0.021 / 0.021 | 82 · 2967 · 0.021 · 334 | `lh-after-devtools.json` |

**Delta, before → after (final), median runs:**

| Metric | Budget | simulated | devtools |
|---|---|---|---|
| CLS | ≤ 0.1 | 0 → 0.019 | **0.147 → 0.021** (all 3 runs 0.146–0.147 before, 0.021 after) |
| LCP | ≤ 2.5 s | 2110 → 2470 ms (runs: 1539–2964 before, 2166–2642 after) | 5266 → 2967 ms (runs: 2817–5419 before, 2725–3785 after) |
| Performance score | — | 94 → 92 | 62 → 82 |
| TBT | — | 205 → 190 ms | 197 → 334 ms |

**The improvement (commit `ed7f1e5`, "reserve space so late data no longer shifts the layout"):**
- The Now/Next strip draws its final box at once: two columns, at most 3 single-line rows each, extra rooms collapse into "And N more". Before, it rendered nothing until `/api/status` answered.
- The program filters wait for `/api/meta` instead of drawing with an empty Day list that grows when it arrives.
- The Live badge reserves the width of its longest label. On narrow screens the masthead is a grid, so the badge can't re-wrap the title.

**What Lighthouse attributed the shifts to** (its `layout-shifts` audit, the same in all 3 runs of each row):
- before, devtools: **0.105–0.106 on `div.catalog-layout`** (no cause listed), 0.021 on `div.catalog-layout` ("Web font loaded"), 0.020 on `section.results`.
- after (final), devtools: **only 0.021 on `div.catalog-layout`, cause "Web font loaded"**.
- after (final), simulated: 0.021 (`div.catalog-layout`) and 0.019 (`div.loading`), both "Web font loaded". Before, simulated runs showed 0.011 / 0 / 0, i.e. the 0.106 shift never appeared in simulated mode, although it appeared in every devtools run of the same deployment that day.

**Other facts:**
- The LCP element was `<p class="lede">` (the intro sentence under "Program") in every run, before and after. In every run the observed LCP equalled the observed FCP.
- Both after rows serve the same JavaScript file (`index-B90xKGRO.js`); `c1dc15c` only removed one line from `index.html`. In the final simulated runs, the observed (unthrottled) load was slower on the network than in the `ed7f1e5` runs half an hour earlier: document response 228–563 ms vs 118 ms, and the JS download 0.33–0.92 s vs 0.13 s for the same 112 KB file. CPU work was similar (boot-up 462–538 ms vs 512 ms).
- **The preload episode:** `ed7f1e5` also added `<link rel="preload" href="/api/meta">`. Its simulated LCP came out 415–484 ms later than FCP in all 3 runs (median LCP 2913 ms, over budget), so the preload was tested on a local build: simulated LCP median 3613 ms with it, 3231 ms without, and no difference under devtools throttling. It was removed in `c1dc15c`. Details: `after-with-preload-ed7f1e5/NOTES.md`. (That A/B ran in the AI assistant's workspace, not on my laptop; the production rows above are the comparison I rely on.)

**Interpretation ✍️** (your words; facts above):
1. Did the improvement work? Which number shows it, and why is it the devtools row and not the simulated one?
2. Why could simulated mode not see a shift that every devtools run saw? (Hint: when does the data arrive relative to the first paint in each mode?)
3. LCP and the score moved in both directions between rows. Is that the change or noise? Use the run ranges and the network facts, not just the medians.
4. What is left: the 0.021 font shift. What would you try next (for example a fallback font with matching metrics, or `font-display: optional`), and what would it cost?

### RUM pilot (facts)

`evidence/05-performance/rum-summary.json`, saved 2026-11-18 21:36:22 UTC by `rum-summary.ps1 -Since 2026-11-18T21:20:00Z`. The window opens after `c1dc15c` went live (21:06 UTC), so every page view in it saw the final version. Earlier page views (testing while building) are excluded by `since`. Lab traffic never reaches the collector: `web/src/lib/rum.ts` sends nothing from Lighthouse, headless Chrome, WebDriver-driven browsers or the desktop-app browser pane the AI assistant used (`isAutomated`, tested in `web/test/rum.test.ts`).

| Cohort | Device | Page views | LCP p75 | INP p75 | CLS p75 | FCP p75 | TTFB p75 |
|---|---|---:|---:|---:|---:|---:|---:|
| desktop | Windows laptop, Chrome (network: ✍️ fill in) | 3 | 700 ms | 72 ms | 0.001 | 700 ms | 301 ms (n=3) |
| mobile | iPhone, Chrome, Wi-Fi | 4 | 153 ms | 48 ms | **no data** | 153 ms | 130 ms (**n=1**) |

- 7 page views in total, by one person (me), on one home network.
- The iPhone sent **no CLS at all**. Every browser on iOS, Chrome included, runs on Apple's WebKit engine, and WebKit does not implement the Layout Instability API that CLS is measured with. LCP and INP did arrive from the phone.
- The phone reported TTFB for 1 of its 4 page views; FCP, LCP and INP for all 4.
- Budget check: LCP, INP and CLS p75 are within budget in every cohort that reported them.

**Interpretation ✍️:** how much does a p75 of 3–4 samples tell you? What does the missing iPhone CLS mean for a festival audience that is mostly on phones? Why might the phone report TTFB once and LCP so low (hint: how does web-vitals treat a page restored from the back/forward cache)? Include the sentence: *we have no CrUX data because the origin is below Chrome's reporting threshold.*

- **k6:** `k6-summary.txt`. The profile is the course file, unmodified (sha256 recorded). It ran against **my own production** because ReelSchedule has no separate staging yet.

## Task 6 — Bundle size

**The production build's size report** is Render's build log for the live commit `c1dc15c` (`evidence/06-bundle/render-build-log-c1dc15c.txt`; Vite's table, sizes before compression):

| Emitted asset | Size | Vite's gzip estimate |
|---|---:|---:|
| `index.html` | 0.66 kB | 0.39 kB |
| 5 web-font files (`.woff2`, two families) | 9.78–46.75 kB each | — |
| `index-8QA3ZZYN.css` | 17.09 kB | 4.59 kB |
| **`index-B90xKGRO.js` (largest JS asset)** | **353.47 kB** | 109.40 kB |
| `index-B90xKGRO.js.map` | 1,911.55 kB | — |

**What production actually sends** (`evidence/06-bundle/asset-size-report-c1dc15c.txt`, `scripts/asset-size.ps1`, 2026-11-18 21:41 UTC; curl, no decoding):

| File | br | gzip | identity |
|---|---:|---:|---:|
| `index-B90xKGRO.js` | **110,898** | 108,234 | 353,474 |
| `index-8QA3ZZYN.css` | 4,701 | 4,569 | 17,097 |
| `index-B90xKGRO.js.map` | 462,203 | — | 1,911,676 (status 200, `cf-cache-status: HIT`) |

- **Largest JS vs budget:** 110,898 bytes with Brotli (what Chrome negotiates) against the 200 KB compressed budget: **55%** of it.
- Brotli came out larger than gzip again (+2,664 bytes), as in Task 4.
- The JS file's last line is `//# sourceMappingURL=index-B90xKGRO.js.map`, and that map was publicly downloadable: 1.9 MB of the original TypeScript source, comments included.

**What the largest JS file is made of** (minified bytes, from the map; `scripts/bundle-composition.mjs`, cross-checked against `source-map-explorer` within 16 bytes per group):

| Package / code | Bytes | Share |
|---|---:|---:|
| react-dom | 206,948 | 58.5% |
| app code (`web/src`) | 48,226 | 13.6% |
| react-router | 38,268 | 10.8% |
| @tanstack/query-core | 32,878 | 9.3% |
| web-vitals | 11,443 | 3.2% |
| react | 8,154 | 2.3% |
| scheduler | 3,485 | 1.0% |
| @tanstack/react-query | 2,261 | 0.6% |
| unmapped (bundler glue) | 1,811 | 0.5% |

**Decision: reduce — the production build no longer emits a source map.** `web/vite.config.ts`: `sourcemap: true` → `false`. Facts about the change:
- Visitors' bytes barely move: the JS loses only its 43-byte `sourceMappingURL` line (353,474 → 353,431 bytes in a local build). The map was never part of a normal page load; browsers fetch it only when DevTools is open.
- **The JS file name did not change** (`index-B90xKGRO.js` in both builds): Rollup computes the hash before it appends the source-map comment. So for once a hashed asset changed under the same name. Cloudflare had both the JS and the map cached as `immutable`, so both URLs are purged once after the deploy. This is the one exception to "never purged" in the cache-policy matrix.
- A bundle analysis is still possible: `npm run build -w web -- --sourcemap hidden` writes a map locally that the JS does not link to.

**After the change** (commit `39b13bb` live; `evidence/06-bundle/asset-size-report-39b13bb.txt`, 2026-11-18 22:00 UTC):

| | Before (`c1dc15c`) | After (`39b13bb`) |
|---|---:|---:|
| `index-B90xKGRO.js`, identity | 353,474 | 353,431 (−43) |
| `index-B90xKGRO.js`, br | 110,898 | 110,864 (−34) |
| `index-B90xKGRO.js`, gzip | 108,234 | 108,199 (−35) |
| JS names a source map | `index-B90xKGRO.js.map` | (none) |
| `GET index-B90xKGRO.js.map` | 200, 1,911,676 bytes, `HIT` | **404**, 125-byte JSON error, `BYPASS` |

- The new JS came from Cloudflare's cache (`HIT`), so the edge held the new file under the old name.
- The CSS file was byte-identical in both runs (17,097 bytes uncompressed), yet its compressed size changed: br 4,701 → 4,711, gzip 4,569 → 4,576. Cloudflare compresses at the edge, and the output for the same file differed between the two captures.

**Rationale ✍️** (your words): why reduce rather than keep or defer? What did the public map expose, and does that matter if the GitHub repository is public? What do you give up (readable stack traces from production)? Why is "keep" right for the bundle itself (55% of budget, mostly react-dom)?

## Tasks 7–9 — TODO
To be filled after those captures.

## Challenged AI claim ✍️

Pick one candidate (or your own), verify it yourself, and write it up in your own words.

Candidate A, measured on 2026-11-18: the AI assistant added `<link rel="preload" href="/api/meta">` to `ed7f1e5` with the claim that starting the metadata request "while the JavaScript downloads" would help the page load. Lighthouse on production said otherwise: simulated median LCP went to 2913 ms (budget 2.5 s), with LCP 415–484 ms after FCP in every run. A with/without test showed the preload cost simulated LCP and saved nothing under real throttling, and the code shows why: the page already starts all its queries at once. Removed in `c1dc15c`. Evidence: the Lighthouse table above and `evidence/05-performance/after-with-preload-ed7f1e5/NOTES.md`.

Candidate B: the AI-written README says the HTML shell is "revalidated every time (cheap 304 via ETag)". Through Cloudflare, the shell arrives **without an ETag** (observed 2026-11-17: `etag: null`, `content-encoding: zstd`), so a browser revalidation downloads the whole shell. Evidence to capture: `curl.exe -sSI https://reel.miniexhibit.app/` (no ETag) vs `curl.exe -sSI https://reelschedule-api-arpita.onrender.com/` (ETag present). Then say what you changed or accepted.
