# ReelSchedule

Scheduling console for the **Lakeshore Film Festival**, a fictional festival. The public browses the program, and festival programmers schedule, move and cancel screenings. The system makes sure no room is double-booked, including the turnaround time between films. Course project for CSC 436 (Option 6, Entertainment domain).

- **Public program**: search and filter by day, room, genre and status. Live updates arrive with no page reload.
- **Rooms by day**: every room side by side. Each screening shows its runtime (solid) and its turnaround buffer (striped).
- **Programmer console**: find a film on TMDB and add it. Pick a room and time, preview the interval and any conflicts, then schedule. Moving and canceling screenings uses optimistic concurrency.
- **Enforced by the API, not the UI**: roles and scopes come from validated tokens. Overlap rules are enforced in PostgreSQL. Every write gets an append-only audit record.

> **Status:** core product complete (API + web + tests). Still to come: Entra ID sign-in, MCP server and App, observability, deployment and operations. See [What's next](#whats-next).

---

## Quick start (local)

Requirements: **Node 22+** and **PostgreSQL 16+** (the `btree_gist` extension ships with PostgreSQL).

```bash
npm install
createdb reelschedule
createdb reelschedule_test               # used by the test suite
cp api/.env.example api/.env             # local settings; never commit api/.env
npm run migrate                          # versioned, reversible migrations
npm run seed                             # synthetic venues, rooms, films, screenings
npm run -s dev-token -w api -- programmer   # prints a local programmer token (also: viewer)
npm run dev:api                          # API on http://localhost:3001
npm run dev:web                          # web on http://localhost:5173 (proxies /api to the API)
```

Open http://localhost:5173, choose **Sign in**, and paste the token. Use `-- viewer` to see the read-only experience. The API still refuses that token's writes with 403.

### Tests (one command)

```bash
npm test          # API suite (needs PostgreSQL) then web suite
npm run typecheck # strict TypeScript, both workspaces
```

The API tests rebuild `reelschedule_test` from the migrations and the seed. To use another database, set `TEST_DATABASE_URL`. TMDB is always stubbed in tests, so no network calls and no key are needed.

---

## The scheduling rule (hand-predicted before the code was run)

```
ends_at        = starts_at + runtime
occupied_until = ends_at   + turnaround buffer
two screenings in one room conflict when [starts_at, occupied_until) intervals overlap
```

| Case (Main Hall, default 15-min buffer) | Predicted | Test |
|---|---|---|
| 18:00 start, 105-min film | ends 19:45, room busy until **20:00** | `schedule.test.ts`, `api.test.ts` |
| Another screening at **19:50** | **409 conflict** | ✔ |
| Another screening at **20:00** | **allowed**: intervals are half-open, so back-to-back is fine | ✔ |
| Film with no runtime | **400 `runtime_missing`**, never treated as 0 minutes | ✔ |

- **Runtime snapshot:** the runtime is copied onto each screening when it is scheduled. A later TMDB change does not move existing screenings. Moving a screening keeps the saved runtime (tested).
- **Enforced in the database:** an exclusion constraint makes double-booking impossible even under concurrent writes:
  ```sql
  EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, occupied_until, '[)') WITH &&) WHERE (status = 'scheduled')
  ```
  CHECK constraints tie `ends_at` and `occupied_until` to the runtime and buffer, so the stored times can't drift from the formula.
- **Game Day race:** two programmers book the same slot at the same moment. Exactly one gets `201` and the other gets `409 schedule_conflict` with the conflicting screening. Only one row and one audit record are written (tested with `Promise.all`).

---

## Architecture

```
Browser (React + TS, built by Vite)
  │  one origin: HTML, /assets/*, /api/* and SSE /api/events
  ▼
CDN (Cloudflare) ── cache policy per content class (see Caching)
  ▼
API (Node 22, Express 5, TypeScript strict, zod validation) — also serves the React build
  ├─ auth: JWT validation (signature, iss, aud, exp), roles + scopes per route
  ├─ services: screenings (interval math, overlap guard, optimistic versioning), films
  ├─ TMDB client: server-side only; timeout, bounded retry, cache, outage policy
  ├─ audit: append-only rows for every write (actor, before/after, request id)
  └─ events: change_events table + LISTEN/NOTIFY → SSE fan-out with replay
  ▼
PostgreSQL 16 (exclusion constraint, CHECKs, audit trigger, provider cache)
```

Repository layout: `api/` (server, migrations, scripts, tests) and `web/` (React app and tests), using npm workspaces.

### Data model

| Table | Purpose |
|---|---|
| `venues`, `rooms` | Synthetic venues and rooms (seats > 0, unique name per venue) |
| `film_references` | Film metadata, from TMDB (`tmdb_id`) or synthetic. `runtime_minutes` may be NULL (unknown) |
| `screenings` | Film + room + `starts_at`, runtime snapshot, buffer, computed `ends_at`/`occupied_until`, `status`, `version` |
| `audit_events` | Append-only (a trigger rejects UPDATE/DELETE): actor, channel (`rest`/`mcp`), action, before/after JSON, request id |
| `change_events` | Ordered change log that drives live updates and replay |
| `provider_cache` | Cached TMDB responses with fetch time and expiry |
| `schema_migrations` | Applied migration versions (each has an `.up.sql` and a `.down.sql`) |

---

## API

Errors always look like `{ "error": { "code", "message", "details?", "requestId" } }`. Every response carries `X-Request-Id`.

| Method & path | Who | Notes |
|---|---|---|
| `GET /healthz` | public | DB status, commit SHA, build id, SSE client count |
| `GET /api/meta` | public | Festival name, time zone, default buffer, festival days |
| `GET /api/screenings` | public | `q, date, roomId, genre, status, page, pageSize` (max 100) |
| `GET /api/screenings/:id` | public | |
| `GET /api/rooms`, `GET /api/rooms/:id/schedule?date=` | public | |
| `GET /api/films`, `GET /api/genres` | public | |
| `GET /api/events` | public | Server-Sent Events. Accepts `Last-Event-ID` or `?lastEventId=` |
| `GET /api/status` | public | Now showing / next up. Behind the app-layer cache: `X-Cache: HIT \| MISS`, cleared on every write |
| `GET /api/now` | public | Festival clock. Volatile body (never revalidates); edge may reuse 2 s |
| `POST /api/vitals` | public | Core Web Vitals beacon (RUM pilot): validated, rate-limited, latest value per page view + metric |
| `GET /api/vitals/summary` | public | p75 per cohort (desktop/mobile) and metric, with sample counts |
| `GET /api/me` | signed in | Validated claims: subject, roles, scopes, `canProgram` |
| `GET /api/films/search?q=` | Programmer + `Schedule.Read` | TMDB search (cached, rate-limited) |
| `POST /api/films/import` | Programmer + `Schedule.Write` | `{ tmdbId }` → 201 new / 200 refreshed |
| `POST /api/screenings/preview` | Programmer + `Schedule.Read` | Interval + conflicts, writes nothing |
| `POST /api/screenings` | Programmer + `Schedule.Write` | `{ filmId, roomId, startsAt (ISO with offset), bufferMinutes? }` → 201 + `Location` |
| `PATCH /api/screenings/:id` | Programmer + `Schedule.Write` | `{ version, startsAt?, roomId?, bufferMinutes? }` |
| `POST /api/screenings/:id/cancel` | Programmer + `Schedule.Write` | `{ version, reason }` |

Status codes used: `400 validation_failed / runtime_missing / invalid_json`, `401 unauthenticated / invalid_token`, `403 forbidden / insufficient_scope`, `404 not_found`, `409 schedule_conflict / stale_version / invalid_state / concurrent_update`, `413`, `429 rate_limited`, `503 provider_unavailable`.

---

## Authorization

- **Roles** (app roles in the token's `roles` claim): `Festival.Programmer` and `Festival.Viewer`.
- **Scopes** (in `scp`): `Schedule.Read` and `Schedule.Write`. Writes need the Programmer role **and** the write scope.
- **Token validation:** RS256 signature against the issuer's JWKS, plus `iss`, `aud`, `exp` and `sub`, with 30 s clock tolerance. The actor recorded in audit rows is `oid ?? sub`.
- **Local development:** `npm run dev-token -w api -- programmer|programmer2|viewer|readonly-prog` signs tokens with a local key in `api/.dev-auth/` (git-ignored). The API trusts that key only when `DEV_AUTH_JWKS_FILE` is set, and **refuses to start** with it in production.
- **Production:** Microsoft Entra ID (Auth Code + PKCE in the browser), configured through `AUTH_ISSUER`, `AUTH_AUDIENCE` and `AUTH_JWKS_URI`.
- The web app hides programmer controls for viewers only for convenience. Tests prove the API rejects viewer, wrong-scope, wrong-audience, wrong-issuer, expired and wrongly signed tokens.

## Live updates

**Why SSE:** updates flow one way (server → browsers), and every write already goes through REST. SSE gives plain HTTP, automatic reconnect and `Last-Event-ID` resume, all built into browsers, with no WebSocket server to run.

- **No lost or repeated events:**
  - Each committed change is written to `change_events` in the same transaction as the write.
  - A transaction-scoped advisory lock makes ids commit in order: a client that saw event 7 can never miss event 6.
  - Notifications are relayed one at a time.
  - Live events that arrive while a reconnecting client is replaying are buffered, then flushed, so each client sees strictly increasing ids.
  - The browser also deduplicates by id (tested on both sides).
- **Reconnect:**
  - The browser resumes automatically with `Last-Event-ID`.
  - If the stream closes for good, the client reopens it with backoff (1 s doubling to 30 s, plus jitter) and `?lastEventId=`.
  - A client more than 500 events behind gets `resync` and reloads.
- **Multiple API instances:** fan-out uses PostgreSQL `LISTEN/NOTIFY`, so a change made on any instance reaches clients on all of them.

## Caching

| Response | Header | Why |
|---|---|---|
| HTML shell (`/`, app routes) | `Cache-Control: public, max-age=0, must-revalidate` + `CDN-Cache-Control: max-age=30` + ETag + strict CSP | Browsers revalidate every time. After a deploy the new shell (pointing at new asset names) reaches everyone within 30 s, or at once after a purge |
| Hashed assets `/assets/*` | `public, max-age=31536000, immutable` | A filename never changes content. A missing asset is a JSON 404, never the HTML shell |
| Public API GETs | `Cache-Control: public, max-age=0, s-maxage=10` + `CDN-Cache-Control: max-age=10, stale-while-revalidate=20, stale-if-error=600` + ETag | Browsers always revalidate (cheap 304). The CDN may hold a copy for 10 s, refresh in the background, and serve stale for 10 minutes if the origin is down |
| `/api/now` | `public, max-age=0` + `CDN-Cache-Control: max-age=2` | The body changes on every request, so it can never be revalidated; the edge may reuse it for 2 s |
| Any request with `Authorization` | `private, no-store` | Personal or permissioned data never lands in a shared cache |
| Errors, SSE, `/healthz` | `no-store` | |

After each live event, clients add `?v=<latest change id>` to public reads. That gives each change a new cache key: the first viewer's request fills the edge, every other viewer gets the fresh copy, and nobody sees a pre-change schedule. The API ignores `v`.

## TMDB integration

- **Server-side only.** The read token is sent in an `Authorization` header and never reaches the browser or the logs (log redaction is tested).
- **Timeouts and retries:** each request has a 3 s timeout. Network errors, timeouts, 429 and 5xx are retried up to 2 times with exponential backoff and jitter. A 4xx is never retried, and a TMDB 404 becomes our 404.
- **Validation:** responses are checked with zod, so a malformed payload counts as a failure. A runtime of `0` is stored as unknown.
- **Cache:** searches for 10 minutes, film details for 24 hours, in PostgreSQL.
- **Outage policy:** if TMDB is down, serve the cached copy labeled `stale: true` with its `fetchedAt` time. With no cached copy, return `503 provider_unavailable`. The schedule itself never depends on TMDB being up (tested).
- **Attribution:** "This product uses the TMDB API but is not endorsed or certified by TMDB."

## Security notes

- **CORS:** exact-origin allowlist; `*` is rejected at startup.
- **Headers:** `helmet` security headers on the API (CSP `default-src 'none'`).
- **Request limits:** 16 KB JSON body limit. Rate limits on writes (30/min) and TMDB-backed calls (20/min), keyed by user or IP.
- **Logs:** structured JSON with redaction of tokens, keys and authorization headers.
- **Database:** parameterized SQL only. `LIKE` input is escaped.

## Deploying (Render)

Everything is described in [`render.yaml`](render.yaml), a Render Blueprint:

| Resource | What it is |
|---|---|
| `reelschedule-db` | PostgreSQL 16 (free plan, Ohio region, no public access) |
| `reelschedule-api-arpita` | The app (free web service): the API **and** the React build from one origin, so a single hostname sits behind the CDN. Health check `/healthz`. Runs migrations and loads the synthetic festival on startup (`RUN_MIGRATIONS`, `SEED_DEMO_DATA`), both safe to repeat |

**CI/CD:**
- `.github/workflows/ci.yml` runs type-checks, both test suites (against a real PostgreSQL 16) and a production build on every push.
- Both Render services use `autoDeployTrigger: checksPass`, so `main` deploys only after CI is green.
- Render keeps the previous deploy serving until the new one passes `/healthz`. Rolling back is "Rollback" on any earlier deploy in the Render Dashboard.

**Release identity:** `/healthz` reports the deployed commit (`RENDER_GIT_COMMIT`), whether sign-in is configured, and how many live clients are connected.

**Before Entra ID is set up:** the API runs read-only and fails closed. Public pages work, and every change answers 401.

**Free-plan limits worth knowing:**
- The API sleeps after 15 minutes without traffic, and the first request then takes about a minute.
- The free database expires 30 days after it's created.
- Free web services have no edge caching, so the API's `CDN-Cache-Control` takes effect once a CDN sits in front of the API (custom-domain step).

## Environment variables (API)

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` forbids `DEV_AUTH_JWKS_FILE`. The `AUTH_*` variables must be set all together; with none set, the API is read-only |
| `PORT` | `3001` | |
| `DATABASE_URL` | `postgres://postgres@localhost:5432/reelschedule` | |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins |
| `FESTIVAL_TIMEZONE` | `America/Chicago` | All festival days and times use this zone |
| `DEFAULT_BUFFER_MINUTES` | `15` | 0–120 |
| `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URI` | dev values | Entra ID tenant / API app values in production |
| `DEV_AUTH_JWKS_FILE` | unset | Local development tokens only |
| `TMDB_BASE_URL`, `TMDB_READ_TOKEN` | TMDB v3, unset | Without a token, TMDB search answers 503 and everything else works |
| `TMDB_TIMEOUT_MS`, `TMDB_MAX_RETRIES` | `3000`, `2` | |
| `COMMIT_SHA`, `BUILD_ID` | Render's `RENDER_GIT_COMMIT` / service name, else `unknown`, `local` | Reported by `/healthz` for release identity |
| `RUN_MIGRATIONS`, `SEED_DEMO_DATA` | `false` | Run migrations / load the synthetic festival at startup (both idempotent) |

Also `SERVE_WEB` (default `true`) and `WEB_DIST_DIR` (default `web/dist` when it exists): the API serves the React build from its own origin.

Web: `VITE_API_BASE_URL` (empty means same origin; in development the Vite proxy forwards `/api`).

## What's next

- [ ] Entra ID sign-in in the web app (Auth Code + PKCE, state and nonce), with app roles and scopes in the tenant
- [ ] MCP server: `search_films`, `list_screenings`, `get_room_schedule` (read) and `schedule_screening` (confirmed write, audited as `via: mcp`)
- [ ] MCP App previewing the interval, buffer and conflicts before confirmation
- [ ] OpenTelemetry traces across web → API → DB/TMDB; SLI/SLO and a fired alert
- [ ] Core Web Vitals before/after; keyboard and axe checks recorded (axe currently reports 0 violations on every page)
- [x] Production deploy on Render (Blueprint) with CI-gated auto-deploys and `/healthz` checks
- [ ] Staging environment, custom domain, DNS/TTL, CAA, certificate-expiry alert
- [ ] Cost estimate (1×/10×/100×), runbook, Game Day, postmortem, diagrams, AI-use log
