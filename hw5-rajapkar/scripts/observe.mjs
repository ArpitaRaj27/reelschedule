#!/usr/bin/env node
/* ============================================================================
   HW5 Task 9 — one latency metric, request logs joined by request id, and
   cache status from the client side, on production.

   Step 1 (sample):  node hw5-rajapkar/scripts/observe.mjs
     Sends 12 anonymous GETs to https://reel.miniexhibit.app/api/status in
     4 bursts of 3 (0 s, 2 s, 4 s), 35 s apart, so each burst starts after the
     edge copy has gone stale (CDN max-age 10 s + stale-while-revalidate 20 s)
     and the next two requests can be answered from the edge copy. Every request
     carries its own X-Request-Id: hw5t9-<run>-<nn>. Writes
       evidence/09-observability/client-sample.json and client-sample.md
     and prints the text to search for in the Render logs.

   Step 2 (by hand): Render dashboard -> the API service -> Logs, search for
     the printed hw5t9-<run> text, copy the matching lines into
       evidence/09-observability/origin-log.txt
     (the API writes one JSON "request" line per request it served:
     requestId, method, path, status, ms).

   Step 3 (join):    node hw5-rajapkar/scripts/observe.mjs join
     Joins the two on the request id and writes evidence/09-observability/joined.md:
     which requests reached the origin, which the edge answered alone, both
     latencies, and request count / latency summary.

   Only anonymous public requests; no credentials, nothing written to the app.
   OBSERVE_OUT overrides the folder, OBSERVE_BASE the site.
   Sets process.exitCode instead of calling process.exit() (nodejs/node#56645).
   ========================================================================== */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.OBSERVE_OUT || path.join(here, "..", "evidence", "09-observability");
const base = (process.env.OBSERVE_BASE || "https://reel.miniexhibit.app").replace(/\/$/, "");
const PATH = "/api/status";
const THRESHOLD_MS = 60_000; // the SLO probe's threshold (scripts/slo-probe.mjs)

process.exitCode = await (process.argv[2] === "join" ? join() : sample());

async function sample() {
  mkdirSync(out, { recursive: true });
  const run = new Date().toISOString().replace(/\D/g, "").slice(2, 12); // yymmddhhmm, UTC
  const rows = [];
  const started = new Date().toISOString();
  console.log(`# observe ${started}  GET ${base}${PATH}  run hw5t9-${run}`);
  let n = 0;
  for (let burst = 1; burst <= 4; burst++) {
    if (burst > 1) await sleep(35_000);
    for (const offset of [0, 2_000, 4_000]) {
      if (offset) await sleep(2_000);
      n++;
      const r = await one(`hw5t9-${run}-${String(n).padStart(2, "0")}`);
      rows.push({ n, burst, ...r });
      console.log(`${String(n).padStart(2)}  burst ${burst}  ${r.sentId}  HTTP ${r.http}  ${String(r.clientMs).padStart(6)} ms  edge ${r.cache.padEnd(8)} age ${String(r.age).padEnd(3)} app ${r.appCache.padEnd(4)} returned ${r.returnedId}`);
    }
  }
  const data = { run: `hw5t9-${run}`, base, path: PATH, started, finished: new Date().toISOString(), rows };
  writeFileSync(path.join(out, "client-sample.json"), JSON.stringify(data, null, 2) + "\n");
  writeFileSync(path.join(out, "client-sample.md"), clientTable(data));
  console.log(`\nwrote ${path.join(out, "client-sample.json")} and client-sample.md`);
  console.log(`\nNext: Render -> API service -> Logs, search for   hw5t9-${run}`);
  console.log(`copy the matching lines into ${path.join(out, "origin-log.txt")}, then run:  node hw5-rajapkar/scripts/observe.mjs join`);
  return 0;
}

async function one(sentId) {
  const at = new Date().toISOString();
  const t0 = performance.now();
  try {
    const res = await fetch(base + PATH, { headers: { "X-Request-Id": sentId, "User-Agent": "reelschedule-hw5-observe/1" }, signal: AbortSignal.timeout(90_000) });
    const text = await res.text();
    const h = (k) => res.headers.get(k) ?? "-";
    let valid = false;
    try { const b = JSON.parse(text); valid = Array.isArray(b.nowShowing) && Array.isArray(b.nextUp); } catch { /* not JSON */ }
    return { sentId, at, http: res.status, clientMs: Math.round(performance.now() - t0), cache: h("cf-cache-status"), age: h("age"), appCache: h("x-cache"), returnedId: h("x-request-id"), ray: h("cf-ray"), valid };
  } catch (error) {
    return { sentId, at, http: "-", clientMs: Math.round(performance.now() - t0), cache: "-", age: "-", appCache: "-", returnedId: "-", ray: "-", valid: false, error: String(error.cause?.code ?? error.message) };
  }
}

function clientTable(d) {
  const lines = [
    `# Client-side sample: GET ${d.base}${d.path}`,
    "",
    `Run \`${d.run}\`, ${d.started} to ${d.finished} (UTC). Anonymous requests, 4 bursts of 3, bursts 35 s apart.`,
    "`edge` is Cloudflare's `cf-cache-status`; `app` is the API's own in-process cache (`X-Cache`) as recorded on the response that was served.",
    "",
    "| # | burst | sent X-Request-Id | HTTP | client ms | edge | Age | app | returned X-Request-Id | cf-ray |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...d.rows.map((r) => `| ${r.n} | ${r.burst} | \`${r.sentId}\` | ${r.http} | ${r.clientMs} | ${r.cache} | ${r.age} | ${r.appCache} | \`${r.returnedId}\` | ${r.ray} |`),
    "",
  ];
  return lines.join("\n");
}

async function join() {
  const sampleFile = path.join(out, "client-sample.json");
  const logFile = path.join(out, "origin-log.txt");
  if (!existsSync(sampleFile) || !existsSync(logFile)) {
    console.error(`observe join: needs ${sampleFile} (step 1) and ${logFile} (step 2, copied from the Render logs)`);
    return 2;
  }
  const d = JSON.parse(readFileSync(sampleFile, "utf8"));
  // Render prefixes each line with its own timestamp; the API's line is the JSON object after it.
  const origin = new Map();
  let parsed = 0;
  for (const line of readFileSync(logFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("{");
    if (i < 0) continue;
    try {
      const o = JSON.parse(line.slice(i));
      parsed++;
      if (o.msg === "request" && typeof o.requestId === "string") origin.set(o.requestId, o);
    } catch { /* not one of the API's lines */ }
  }
  const sent = new Set(d.rows.map((r) => r.sentId));
  const firstById = new Map(d.rows.map((r) => [r.sentId, r.n]));
  const rows = d.rows.map((r) => {
    const o = origin.get(r.sentId);
    let reading;
    if (o) reading = `reached the origin: logged ${o.status} in ${o.ms} ms`;
    else if (r.returnedId !== r.sentId && firstById.has(r.returnedId)) reading = `edge only: answered with the copy stored from request #${firstById.get(r.returnedId)}`;
    else if (r.returnedId !== r.sentId) reading = "edge only: answered with a copy stored from a request outside this sample";
    else reading = "not in the pasted log (check the copy)";
    return { ...r, originMs: o ? o.ms : null, originStatus: o ? o.status : null, reading };
  });
  const extra = [...origin.values()].filter((o) => o.requestId.startsWith(d.run) && !sent.has(o.requestId));

  const pct = (xs, p) => { if (!xs.length) return "-"; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
  const client = rows.filter((r) => typeof r.clientMs === "number" && r.http !== "-").map((r) => r.clientMs);
  const originMs = rows.filter((r) => r.originMs !== null).map((r) => r.originMs);
  const byCache = rows.reduce((m, r) => ((m[r.cache] = (m[r.cache] || 0) + 1), m), {});
  const goodReq = rows.filter((r) => r.http === 200 && r.valid && r.clientMs <= THRESHOLD_MS).length;

  const md = [
    `# Joined: client sample \`${d.run}\` and the API's request log`,
    "",
    `Joined on X-Request-Id. ${origin.size} API request lines parsed from origin-log.txt (${parsed} JSON lines in all).`,
    "A row is joined to an origin line only when the origin logged that exact request id; a response answered by the edge alone has no origin line, and its X-Request-Id is the one stored with the cached copy.",
    "",
    "| # | sent X-Request-Id | HTTP | edge | Age | client ms | origin ms | what happened |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.n} | \`${r.sentId}\` | ${r.http} | ${r.cache} | ${r.age} | ${r.clientMs} | ${r.originMs ?? "—"} | ${r.reading} |`),
    "",
    extra.length ? `Origin lines with this run's prefix that match no client request (for example a background revalidation): ${extra.map((o) => `\`${o.requestId}\` ${o.status} ${o.ms} ms`).join("; ")}` : "No origin lines with this run's prefix outside the client requests.",
    "",
    "## Summary",
    "",
    "| | value |",
    "|---|---|",
    `| requests sent | ${rows.length} |`,
    `| by Cloudflare cache status | ${Object.entries(byCache).map(([k, v]) => `${k} ${v}`).join(", ")} |`,
    `| reached the origin (joined) | ${originMs.length} |`,
    `| client latency, ms (p50 / p95 / max) | ${pct(client, 50)} / ${pct(client, 95)} / ${client.length ? Math.max(...client) : "-"} |`,
    `| origin latency from the API log, ms (p50 / p95 / max) | ${pct(originMs, 50)} / ${pct(originMs, 95)} / ${originMs.length ? Math.max(...originMs) : "-"} |`,
    `| requests meeting the SLI's bar (200, valid body, ≤ ${THRESHOLD_MS / 1000} s) | ${goodReq} of ${rows.length} |`,
    "",
    `With ${rows.length} requests the p95 is simply the slowest request or close to it; treat these as a description of this sample, not a measured distribution.`,
    "",
  ].join("\n");
  writeFileSync(path.join(out, "joined.md"), md);
  console.log(md);
  console.log(`wrote ${path.join(out, "joined.md")}`);
  return 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
