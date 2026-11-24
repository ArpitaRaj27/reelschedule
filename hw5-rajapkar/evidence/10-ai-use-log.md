# AI-use log (HW5)

Course rule: record what AI **generated**, what you **accepted / rejected / changed**, and **how you verified** it. Fill the last two columns yourself; the first two describe what the assistant (Claude) produced in this session.

| Date | What AI generated | Accepted / rejected / changed | How I verified it ✍️ |
|---|---|---|---|
| 2026-11-17 | API change: serve the React build from the API origin; per-content-class `Cache-Control` / `CDN-Cache-Control` headers (`api/src/webApp.ts`, `api/src/app.ts`) | | e.g. `npm test` (delivery.test.ts), headers in `evidence/03-headers/` |
| 2026-11-17 | `/api/status` + in-memory cache-aside with `X-Cache`, single-flight, invalidation on write (`api/src/appCache.ts`) | | `evidence/02-app-cache-miss-hit.txt`, test "MISS → HIT → (write) → MISS" |
| 2026-11-17 | `/api/now`, `/api/vitals` collector, `web/src/lib/rum.ts` (ported from the course `web-vitals-rum.js`) | | |
| 2026-11-17 | Cloudflare setup done through the browser with my approval: zone add, nameserver change at Porkbun, SSL Full (strict), `reel` CNAME, cache rule | | `01-edge-proof.txt`, `01-cdn-config/` export |
| 2026-11-17 | Evidence scripts in `hw5-rajapkar/scripts/` and this README skeleton (facts filled, ✍️ parts left to me) | | I ran each script myself; outputs are in `evidence/` |
| 2026-11-18 | RUM lab-traffic filter (`isAutomated` in `web/src/lib/rum.ts`) and the `?since=` pilot window on `/api/vitals/summary` (commit `2411639`) | | e.g. `web/test/rum.test.ts`, `api/test/delivery.test.ts` |
| 2026-11-18 | Diagnosis of the program-page layout shift (masthead re-wrap, Now/Next strip, Day filter, font swap), done with the AI's own scripts in its workspace | | e.g. the `layout-shifts` audit in `lh-before-devtools.json` |
| 2026-11-18 | The CLS fix in `ed7f1e5` (Now/Next strip, filters wait for `/api/meta`, Live badge, narrow masthead) and its tests | | e.g. `lh-after-devtools.json`: CLS 0.147 → 0.021 |
| 2026-11-18 | The `/api/meta` preload in `ed7f1e5`, then its removal in `c1dc15c` after Lighthouse showed it hurt simulated LCP (a with/without test ran in the AI's workspace) | | e.g. `after-with-preload-ed7f1e5/NOTES.md`, my production runs |
| 2026-11-18 | `lighthouse.ps1` changes: `-Throttling devtools`, retry for runs Lighthouse fails to record; the Task 5 Lighthouse tables in the README (facts only) | | I ran every Lighthouse run myself; numbers come from the `*-summary.txt` files |
| 2026-11-18 | `rum-summary.ps1` run window and the RUM facts table in the README (the visits and devices are mine) | | |
| 2026-11-18 | `asset-size.ps1`, `bundle-composition.mjs` (cross-checked against `source-map-explorer`), the Render build log copied through the browser pane, and the Task 6 tables (facts only) | | e.g. I ran `asset-size.ps1` myself; compare the build log with the Render dashboard |
| 2026-11-18 | Turning off production source maps (`web/vite.config.ts`) after I chose "reduce" | | e.g. the map URL returns 404 after the deploy and purge |
| 2026-11-18 | `load-test.ps1` (course-profile sha256 check, k6 run in the evidence folder, threshold table) and the k6 facts in the README | | e.g. I ran it myself; numbers come from `k6-summary.json` |
| 2026-11-19 | Task 1 config export through my signed-in Cloudflare dashboard (read-only API GETs, no token); flagged Always Use HTTPS off and minimum TLS 1.0 and, with my approval, changed both in the dashboard | | e.g. `zone-settings-before-2026-11-19.json` vs `zone-settings.json`; `http-redirect.txt` |
| 2026-11-19 | Task 7 axe scan script (`scripts/a11y/`) and the fixes for what it found (label in name: wordmark, timeline blocks), plus the Clear filters and page-change focus fixes and their tests (`9cd1ed3`). The focus defects were found by the AI's own keyboard test in its workspace | | e.g. my before/after scans on production; `npm test`; the recording |
| 2026-11-19 | Manual contrast check of axe's "needs review" item and the fix (`5718625`). The canceled-screening numbers were measured by the AI from screenshot pixels on a local build with one screening canceled (production has none) | | e.g. recompute the ratios from the colors in `styles.css` |
| 2026-11-19 | Sign-in form fixes (`adcb658`) and `web/test/sign-in.test.tsx`, found by the AI's keyboard test while preparing my recording | | e.g. step 5 of my recording; the tests fail on the old page |
| 2026-11-19 | Task 7 README facts and the cue sheet for the recording (the recording, narration and ✍️ parts are mine) | | |
| 2026-11-19 | Task 8 detection: `api/test/cache-guard.test.ts` (shown to fail on a deliberate public header on `/api/me`), `scripts/cache-guard.mjs` and the scheduled workflow `.github/workflows/cache-guard.yml` | | e.g. the guard fails on the lab leak and passes after cleanup; CI is green |
| 2026-11-19 | Task 8 lab automation (`scripts/disclosure-lab.mjs`, unchanged course `origin.mjs`/`edge.mjs` in `lab/`) and the facts in `risk.md`; the ✍️ parts of `risk.md` are mine | | e.g. I ran it myself; read `repro.txt` and `cleanup.txt` |
| 2026-11-23 | My first lab run on Windows printed the guard's FAIL table and then crashed (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit 3221226505). The AI traced it to a known Node-on-Windows bug when `process.exit()` runs right after `fetch` (nodejs/node#56645) and changed `cache-guard.mjs` to set `process.exitCode` instead | | e.g. I re-ran the lab; section D now ends with exit 1 |
| 2026-11-23 | Task 9: `scripts/slo-probe.mjs` and the hourly workflow `.github/workflows/slo-probe.yml` (the alert), `scripts/observe.mjs` (request-id sample and join with the Render log), and the facts in the README's Task 9 section. I chose GitHub's e-mail as the channel and suspending Render as the break | | e.g. I read the joined table against the Render log; the alert e-mail arrived |
| 2026-11-24 | Diagnosed the 02:22 UTC cache-guard failure from the run log (`fetch failed`, cause dropped by the script) and added retries and annotations; copied my Render log lines and ran the join; started SLO probe runs #4 and #5 from the Actions tab while I suspended and resumed Render; saved the run pages and cropped my alert e-mail into the evidence. Claimed the annotation would put the reason in the e-mail; my e-mail screenshot shows only the count | | e.g. I compared the e-mail with the run page |

## Challenged AI claim
✍️ See the README section "Challenged AI claim". State the claim, the evidence that contradicted it (file + line), and what you did about it.
