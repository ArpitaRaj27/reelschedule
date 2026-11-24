#!/usr/bin/env node
/* ============================================================================
   scripts/cache-guard.mjs — "a response to a request that carries credentials
   never comes from, and is never stored in, a shared cache."

   This is the detection for cache-key confusion (HW5 Task 8): the incident
   needs a personalized response that a shared cache is allowed to store, plus a
   cache key that does not separate users. Cloudflare's default key is the URL,
   so on reel.miniexhibit.app the origin header is the only thing separating
   users. This check watches both halves from the outside, through the CDN.

     node scripts/cache-guard.mjs https://reel.miniexhibit.app
     node scripts/cache-guard.mjs http://127.0.0.1:8788 --path /account \
          --cookie "sid=sid-alice" --cookie "sid=sid-bob" --personalized

   For each path it sends one GET per credential (two different synthetic users)
   and FAILS when any response:
     - has a cache status other than BYPASS / DYNAMIC / none. MISS fails too: it
       means the response was eligible and stored for whoever asks next;
     - has a Cache-Control that lets a shared cache store it (no `private` /
       `no-store`, or `public` / `s-maxage` present);
     - (with --personalized) is a byte-identical 200 for two different users.

   Credentials: by default two made-up bearer tokens (the API answers 401, which
   still exercises the header contract on credentialed requests). Set
   CACHE_GUARD_TOKENS="tokenA,tokenB" to use real synthetic test users instead.
   Never put a real person's token here.

   Exit 0 = pass, 1 = a credentialed response was cacheable or cached, 2 = could
   not run (network, bad arguments).
   It sets process.exitCode and lets Node finish on its own; it never calls
   process.exit(). On Windows, Node 23 to 26 has been reported to abort with a
   libuv assertion (UV_HANDLE_CLOSING, src\win\async.c line 76;
   nodejs/node#56645) when process.exit() runs right after fetch, and the exit
   code then reads 3221226505 instead of 1.
   ========================================================================== */

process.exitCode = await main();

async function main() {
  const args = process.argv.slice(2);
  const base = (args.find((a) => !a.startsWith("--") && !isValueOf(a)) || "https://reel.miniexhibit.app").replace(/\/$/, "");
  function isValueOf(a) {
    const i = args.indexOf(a);
    return i > 0 && ["--path", "--cookie", "--bearer"].includes(args[i - 1]);
  }
  const many = (flag) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));

  const DEFAULT_PATHS = ["/api/me", "/api/films/search?q=cache-guard"]; // ReelSchedule's signed-in GET routes
  const paths = many("--path").length ? many("--path") : DEFAULT_PATHS;
  const personalized = args.includes("--personalized");

  const fromEnv = (process.env.CACHE_GUARD_TOKENS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const run = Math.random().toString(36).slice(2, 8);
  const credentials = many("--cookie").length
    ? many("--cookie").map((c) => ({ label: `Cookie ${c.split("=")[0]}=${c.split("=").slice(1).join("=").slice(0, 12)}`, headers: { Cookie: c } }))
    : (many("--bearer").length ? many("--bearer") : fromEnv.length ? fromEnv : [`cache-guard-synthetic-a-${run}`, `cache-guard-synthetic-b-${run}`]).map(
        (t, i) => ({ label: `Bearer synthetic user ${String.fromCharCode(65 + i)}`, headers: { Authorization: `Bearer ${t}` } }),
      );
  if (credentials.length < 2) {
    console.error("cache-guard: needs two different credentials (two synthetic users)");
    return 2;
  }

  const SAFE_STATUS = new Set(["BYPASS", "DYNAMIC", "(none)"]);
  const WHY = {
    MISS: "eligible and STORED in the shared cache for whoever asks next",
    HIT: "SERVED FROM the shared cache",
    STALE: "served a stale copy from the shared cache",
    UPDATING: "served from the shared cache while it refreshes",
    REVALIDATED: "a stored copy was revalidated and reused",
    EXPIRED: "a stored copy existed (it had expired)",
  };

  const sha = async (buf) => {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(Buffer.from(buf)).digest("hex").slice(0, 12);
  };

  const failures = [];
  const rows = [];
  console.log(`# cache-guard ${new Date().toISOString()}  ${base}`);
  console.log(`# rule: a response to a request with credentials must be BYPASS/DYNAMIC at the shared cache and say private or no-store`);
  for (const path of paths) {
    const seen = [];
    for (const cred of credentials) {
      let res;
      // A network error is retried twice, 10 s apart: one dropped connection from a CI runner should not page anyone.
      // It still fails the run if all three attempts fail, because an unchecked guard proves nothing.
      for (let attempt = 1; !res; attempt++) {
        try {
          // 90 s: a Render free instance can take ~50 s to wake up.
          res = await fetch(base + path, { headers: { ...cred.headers, "User-Agent": "reelschedule-cache-guard/1" }, redirect: "manual", signal: AbortSignal.timeout(90_000) });
        } catch (error) {
          const why = describe(error);
          if (attempt >= 3) {
            annotate(`could not reach ${base + path} after 3 attempts: ${why}; the app was not checked`);
            return 2;
          }
          console.error(`cache-guard: attempt ${attempt} to reach ${base + path} failed (${why}); retrying in 10 s`);
          await new Promise((r) => setTimeout(r, 10_000));
        }
      }
      // A Cloudflare challenge or block never reached the app, so it proves nothing either way. Fail loudly instead of passing.
      if (res.headers.get("cf-mitigated")) {
        annotate(`Cloudflare answered ${res.status} with cf-mitigated: ${res.headers.get("cf-mitigated")} for ${path} (ray ${res.headers.get("cf-ray")}); the app was not checked`);
        return 2;
      }
      const body = await res.arrayBuffer();
      const status = (res.headers.get("cf-cache-status") || res.headers.get("x-cache-status") || "(none)").toUpperCase();
      const cc = (res.headers.get("cache-control") || "").toLowerCase();
      const row = {
        path,
        who: cred.label,
        http: res.status,
        cache: status,
        age: res.headers.get("age") ?? "-",
        cacheControl: cc || "(none)",
        body: await sha(body),
        ray: res.headers.get("cf-ray") || res.headers.get("x-served-to") || "-",
      };
      rows.push(row);
      seen.push(row);

      if (!SAFE_STATUS.has(status)) failures.push(`${path} as ${cred.label}: cache status ${status}: ${WHY[status] ?? "not a bypass"}`);
      const sharedOk = cc.includes("public") || /s-maxage/.test(cc);
      const privateOrNoStore = cc.includes("private") || cc.includes("no-store");
      if (sharedOk || !privateOrNoStore) failures.push(`${path} as ${cred.label}: Cache-Control "${cc || "(none)"}" lets a shared cache store a credentialed response`);
    }
    if (personalized) {
      const ok200 = seen.filter((r) => r.http === 200);
      if (ok200.length >= 2 && new Set(ok200.map((r) => r.body)).size === 1) failures.push(`${path}: ${ok200.length} different users received byte-identical 200 responses (sha256 ${ok200[0].body})`);
    }
  }

  const cols = ["path", "who", "http", "cache", "age", "cacheControl", "body", "ray"];
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]));
  console.log(cols.map((c) => c.padEnd(width[c])).join("  "));
  for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(width[c])).join("  "));

  if (failures.length) {
    console.log(`\nFAIL (${failures.length}):`);
    for (const f of failures) console.log(`  - ${f}`);
    for (const f of failures.slice(0, 5)) annotate(f);
    return 1;
  }
  console.log(`\nPASS: ${rows.length} credentialed responses, none cacheable or cached by a shared cache`);
  return 0;
}

/** Print the reason, and in GitHub Actions also as an error annotation, so the failure e-mail and run page say why. */
function annotate(message) {
  console.error(`cache-guard: ${message}`);
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::error title=cache-guard::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
}

/** fetch() only says "fetch failed"; the reason (DNS, reset, TLS, timeout) is in error.cause. */
function describe(error) {
  const c = error?.cause;
  if (error?.name === "TimeoutError") return "no answer in 90 s";
  if (!c) return String(error?.message ?? error);
  const inner = c.errors?.length ? c.errors.map((e) => e.code ?? e.message).join(", ") : null; // AggregateError: one per address tried
  return [c.code, c.message, inner].filter(Boolean).join(": ");
}
