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

## Challenged AI claim
✍️ See the README section "Challenged AI claim". State the claim, the evidence that contradicted it (file + line), and what you did about it.
