#!/usr/bin/env node
/* ============================================================================
   scripts/slo-probe.mjs — the SLI check behind ReelSchedule's one alert
   (HW5 Task 9). .github/workflows/slo-probe.yml runs it once an hour, and on
   demand, against https://reel.miniexhibit.app.

   SLI (time-based): the proportion of hourly windows in which
     GET /api/status, requested through Cloudflare, answers 200 with a valid
     festival-status body within 60 s, on the first attempt or on one retry
     30 s later.
   One run of this script judges one window. A bad window exits 1, which fails
   the workflow run, and GitHub e-mails the failure: that is the alert.

   Why 60 s and a retry: Render's free instance sleeps after 15 minutes with no
   traffic, and waking it takes about 30-60 s. An hourly probe nearly always
   finds it asleep, so a tighter threshold would measure the hosting plan's
   sleep, not an outage. The retry gives a slow wake-up a second chance on a
   warm instance; a suspended service or a dead database fails both attempts.

     node scripts/slo-probe.mjs https://reel.miniexhibit.app
     SLO_PROBE_THRESHOLD_MS=60000 SLO_PROBE_RETRY_AFTER_MS=30000 node scripts/slo-probe.mjs <base>

   Every request carries X-Request-Id: slo-probe-<run>-<attempt>. The API logs
   that id on its JSON "request" line, so a probe result can be found in the
   Render logs (unless Cloudflare answered from cache: then the origin never
   saw the request, and the response carries the id of the request it stored).

   Exit 0 = good window, 1 = bad window (alert), 2 = bad arguments.
   Sets process.exitCode instead of calling process.exit(), which can crash
   Node on Windows right after fetch (nodejs/node#56645).
   ========================================================================== */

process.exitCode = await main();

async function main() {
  const base = (process.argv[2] || "https://reel.miniexhibit.app").replace(/\/$/, "");
  if (!/^https?:\/\//.test(base)) {
    console.error("usage: node scripts/slo-probe.mjs https://reel.miniexhibit.app");
    return 2;
  }
  const threshold = Number(process.env.SLO_PROBE_THRESHOLD_MS || 60_000);
  const retryAfter = Number(process.env.SLO_PROBE_RETRY_AFTER_MS || 30_000);
  const run = process.env.GITHUB_RUN_ID ? `gh${process.env.GITHUB_RUN_ID}` : `local${Date.now().toString(36)}`;
  const path = "/api/status";

  console.log(`# slo-probe ${new Date().toISOString()}  ${base}${path}`);
  console.log(`# good window = 200 with a festival-status body within ${threshold} ms, on attempt 1 or on one retry ${retryAfter / 1000} s later`);

  const attempts = [];
  for (let n = 1; n <= 2; n++) {
    if (n === 2) await new Promise((r) => setTimeout(r, retryAfter));
    const a = await attempt(base + path, `slo-probe-${run}-${n}`, threshold);
    attempts.push(a);
    if (a.good) break;
  }

  const good = attempts.some((a) => a.good);
  let health = null;
  if (!good) health = await healthz(base); // for the person who gets the e-mail; not part of the SLI

  const cols = ["attempt", "at", "requestId", "http", "ms", "cache", "age", "returnedId", "ray", "verdict"];
  const rows = attempts.map((a, i) => ({ attempt: i + 1, ...a, verdict: a.good ? "good" : `bad: ${a.why}` }));
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]));
  console.log(cols.map((c) => c.padEnd(width[c])).join("  "));
  for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(width[c])).join("  "));
  if (health) console.log(`\n/healthz (diagnosis only): ${health}`);
  console.log(good ? "\nGOOD WINDOW" : "\nBAD WINDOW: the SLO alert fires (this run fails, GitHub e-mails it)");
  if (!good && process.env.GITHUB_ACTIONS === "true") {
    // An error annotation puts the reason in the failure e-mail and at the top of the run page.
    const why = rows.map((r) => `attempt ${r.attempt}: ${r.verdict} (HTTP ${r.http}, ${r.ms} ms, cache ${r.cache}, ray ${r.ray})`).join("; ") + (health ? `; /healthz: ${health}` : "");
    console.log(`::error title=SLO probe: bad window::${why.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    const md = [
      `### ${good ? "Good window" : "Bad window: alert"} — GET ${base}${path}`,
      "",
      `| ${cols.join(" | ")} |`,
      `| ${cols.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${cols.map((c) => String(r[c]).replace(/\|/g, "\\|")).join(" | ")} |`),
      "",
      health ? `\`/healthz\` (diagnosis only): ${health}` : "",
      "",
    ].join("\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
  return good ? 0 : 1;
}

async function attempt(url, requestId, threshold) {
  const at = new Date().toISOString();
  const started = performance.now();
  try {
    // Wait up to 90 s so a slow wake-up is measured (and recorded as slow) rather than cut off.
    const res = await fetch(url, {
      headers: { "X-Request-Id": requestId, "User-Agent": "reelschedule-slo-probe/1", Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    const h = (n) => res.headers.get(n) ?? "-";
    const row = { at, requestId, http: res.status, ms, cache: h("cf-cache-status"), age: h("age"), returnedId: h("x-request-id"), ray: h("cf-ray") };
    let why = null;
    if (res.headers.get("cf-mitigated")) why = `Cloudflare challenge (${h("cf-mitigated")})`;
    else if (res.status !== 200) why = `HTTP ${res.status}`;
    else if (!validStatus(text)) why = "200 but not a festival-status body";
    else if (ms > threshold) why = `slow (${ms} ms > ${threshold} ms)`;
    return { ...row, good: why === null, why };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    return { at, requestId, http: "-", ms, cache: "-", age: "-", returnedId: "-", ray: "-", good: false, why: error.name === "TimeoutError" ? "no answer in 90 s" : `network error (${[error.cause?.code, error.cause?.message ?? error.message].filter(Boolean).join(": ")})` };
  }
}

function validStatus(text) {
  try {
    const b = JSON.parse(text);
    return typeof b.generatedAt === "string" && Array.isArray(b.nowShowing) && Array.isArray(b.nextUp);
  } catch {
    return false;
  }
}

async function healthz(base) {
  try {
    const res = await fetch(base + "/healthz", { headers: { "User-Agent": "reelschedule-slo-probe/1" }, signal: AbortSignal.timeout(30_000) });
    return `HTTP ${res.status} ${(await res.text()).slice(0, 200).replace(/\s+/g, " ")}`;
  } catch (error) {
    return `no answer (${error.cause?.code ?? error.message})`;
  }
}
