# Task 8 — Cross-user cache disclosure: risk write-up

**What it is:** cache-key confusion causing cross-user disclosure, reproduced on the loopback lab pair with synthetic users only (`repro.txt`, `cleanup.txt`). Production (`reel.miniexhibit.app`) was not used for the reproduction.

✍️ **Name it accurately, in your words:**
- Why is this not cache *poisoning*? Who chose the content that got stored, and was anything injected?
- Why is it a real disclosure while it runs, and not a near-miss? Look at what Bob received in `repro.txt` section C.

**My words:** not poisoning; nobody injected anything. The stored response was the correct answer to Alice's own request, handed to someone else because the cache key was the URL alone and the origin said `public`. It is a real disclosure, not a near-miss: in `repro.txt` section C, Bob sent his own cookie and received "Signed in as Alice Nguyen (S0198442)", `HIT`; and in `cleanup.txt` step 1 it kept happening even after the origin was fixed (`HIT`, `Age` 4).

## What would have to be true for this to happen accidentally in ReelSchedule

Facts about the current configuration:

1. **The edge half is already true.**
   - The one Cloudflare Cache Rule (`01-cdn-config/cache-rules.json`, "reel: HTML + public API eligible, respect origin TTL") makes every path on `reel.miniexhibit.app` cache-eligible except `/api/events`, `/api/vitals` and `/healthz`. That includes the signed-in routes `/api/me` and `/api/films/search`.
   - Cloudflare's default cache key is the URL. It does not include the `Authorization` header or cookies.
   - So, as in the lab's `CACHE_KEY=vary-only` edge, nothing at the edge separates users.
2. **The origin half is one line.**
   - Users are kept apart only by `api/src/app.ts`: any request with an `Authorization` header gets `Cache-Control: private, no-store`, and `publicCache()` adds the public headers only when there is no `Authorization` header.
   - `PUBLIC_CACHE` is `public, max-age=0, s-maxage=10`. Under RFC 9111 §3.5 a shared cache may store and reuse a response to a request with `Authorization` when the response says `public` or `s-maxage`. So a single route that sets `PUBLIC_CACHE` on a signed-in response (the deliberate bug in `api/test/cache-guard.test.ts` shows exactly this) would complete the incident.
3. **HW7 makes the origin half easier to break.** Both checks above look only at the `Authorization` header. A BFF login that authenticates with a session **cookie** instead would get *neither* `private, no-store` nor the protection in `publicCache()`. Cloudflare does not put cookies in its cache key. When HW7 lands, both checks must test for "has credentials" (header or session cookie), and the CI test must send the cookie too.

✍️ **In your words:** which of these is the most likely way this happens to you, and what would the deploy look like that causes it? Is "a defensive cache key absorbed it" (lab section B) available to you on Cloudflare Free, and what would it cost?

**My words:** the edge half is already true. Most likely is the HW7 cookie login: both checks only look for an `Authorization` header, so a cookie-only request gets `public, s-maxage=10` and Cloudflare caches `/api/me`. Second: copying `publicCache()` into a signed-in route. On Cloudflare Free I cannot put cookies or headers in the cache key (that is an Enterprise feature); the free equivalent is a Cache Rule that bypasses the cache when there is a session cookie or an `Authorization` header (I still need to check that the rule builder offers those fields).

## Blast radius

Facts:
- **Today:** production runs with sign-in switched off (`/healthz`: `"auth": "disabled"`). Every request that carries credentials is answered 401 `no-store`, so no per-user response exists to leak.
- **With sign-in on:**
  - `/api/me` returns `sub`, `roles`, `scopes` and `canProgram`. A leaked copy would show one programmer's identity and role to someone else, and the web app would draw its signed-in view (including the Schedule link) from it.
  - Writes (`POST`/`PATCH`) are never cached and each one is checked against the caller's own token (`requireAccess`), so a leaked `/api/me` does not grant the right to change the schedule.
  - `/api/films/search` (programmer-only TMDB results) would be readable by anyone requesting the same URL.
- **How long one leaked copy lives**, if the public headers were applied (`CDN-Cache-Control: max-age=10, stale-while-revalidate=20, stale-if-error=600`): 10 s fresh, up to 30 s while revalidating, and up to 10 minutes while the origin is failing. Each Cloudflare data center keeps its own copy.

✍️ **In your words:** who could see what, for how long, and how bad is that for a festival programmer? What changes if HW7 adds names or e-mail addresses to `/api/me`?

**My words:** currently none (sign-in is off, so every request with credentials gets `401 no-store`). With sign-in on, another programmer's id, roles and scopes would be visible to the next person at that data center for 10 seconds (30 seconds while refreshing, 10 minutes if Render fails); writes stay safe; `/api/films/search` results would leak as well. Today that is more embarrassing than harmful; if HW7 adds names or e-mails, it becomes a privacy incident.

## The detection added (so it cannot happen silently)

1. **Before deploy: `api/test/cache-guard.test.ts` (runs in CI on every push).**
   - It walks the API router, so a new route is covered without editing the test.
   - It requests every GET route under `/api` as a programmer and as a viewer, and fails if any answer is missing `private`/`no-store`, says `public` or `s-maxage`, or carries `CDN-Cache-Control`.
   - Render deploys only after the checks pass (`autoDeployTrigger: checksPass`), so a failing test also blocks the deploy.
   - It was shown to fail on a deliberate `PUBLIC_CACHE` on `/api/me` (both users, all four headers named).
2. **In production: `scripts/cache-guard.mjs`, run by `.github/workflows/cache-guard.yml` every 3 hours and on demand.**
   - It sends requests with credentials for two synthetic users through Cloudflare to the signed-in routes.
   - It fails if `cf-cache-status` is anything but `BYPASS`/`DYNAMIC`, including `MISS`, which means "stored for the next person".
   - It also fails if `Cache-Control` would let a shared cache store the response.
   - A Cloudflare challenge also fails the run (exit 2) instead of passing.
   - Evidence that it works: it **fired** on the lab leak (`repro.txt` section D, exit 1) and **passed** after cleanup (`cleanup.txt` step 5, exit 0). On production: `detection-production.txt`.
3. **Limits:**
   - Until production has sign-in and two synthetic test users (`CACHE_GUARD_TOKENS` secret), the production check can only use made-up tokens. That proves the edge and header contract on 401 answers, not on a real signed-in 200.
   - Detection can lag by up to 3 hours.
   - Each run sees one Cloudflare data center.

✍️ **In your words:** why does this detection catch the incident you reproduced? What would it miss (think HW7 cookies)? Would you page someone on it, or is an e-mail enough?

**My words:** CI fails any signed-in GET route whose response is shareable, so the origin half cannot ship; the production guard fails on any stored response. It fired on the lab leak (exit 1) and passed after the cleanup. It misses cookie logins, anything between runs, other data centers, and skipped schedules (GitHub ran it 3 of 13 times; one false alarm on 2026-11-24). An e-mail is enough today; once real people sign in, it should page someone, and the first step is a purge.

## Cleanup, and proof (lab)

`cleanup.txt`, in order:
1. The origin header was reverted first. Bob was **still served Alice's page** from the edge (`HIT`, non-zero `Age`), because reverting does not remove stored copies.
2. `/account` was purged (`x-purged-entries: 1`).
3. Both users re-requested from two different clients (Node and curl): `BYPASS`, each their own page. `BYPASS` is stricter than a fresh `MISS`: the page was not stored at all.
4. The cache key was reverted to `conservative`.
5. The detection was re-run: PASS.
6. The synthetic sessions were invalidated by stopping the lab origin they live in; the same request then got `ECONNREFUSED`.

Limit: on loopback both clients are on 127.0.0.1, so they are two clients rather than two network locations (the lab edge binds loopback only).
