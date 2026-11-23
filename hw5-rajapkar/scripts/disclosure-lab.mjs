#!/usr/bin/env node
/* ============================================================================
   HW5 Task 8 — deliberate cross-user cache disclosure on the LOOPBACK lab pair.

     node hw5-rajapkar/scripts/disclosure-lab.mjs

   Runs the course's origin.mjs + edge.mjs (hw5-rajapkar/lab/, unchanged copies)
   on 127.0.0.1 with synthetic users only, and writes:

     evidence/08-disclosure/repro.txt    safe baseline, mistake 1 alone, both
                                          mistakes (Bob is served Alice's page),
                                          and the detection firing
     evidence/08-disclosure/cleanup.txt  revert origin (not enough: still HIT),
                                          purge, re-request with two clients,
                                          revert the cache key, detection passing,
                                          sessions invalidated

   Nothing here touches reel.miniexhibit.app or any public hostname.
   Ports: ORIGIN_PORT (default 18080) and EDGE_PORT (default 18788).
   ========================================================================== */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const lab = path.join(here, "..", "lab");
const out = process.env.DISCLOSURE_OUT || path.join(here, "..", "evidence", "08-disclosure");
const guard = path.join(here, "..", "..", "scripts", "cache-guard.mjs");
const ORIGIN_PORT = Number(process.env.ORIGIN_PORT || 18080);
const EDGE_PORT = Number(process.env.EDGE_PORT || 18788);
const EDGE = `http://127.0.0.1:${EDGE_PORT}`;
const USERS = { alice: { cookie: "sid=sid-alice", campusId: "S0198442" }, bob: { cookie: "sid=sid-bob", campusId: "S0207731" } };

mkdirSync(out, { recursive: true });
let log = [];
const say = (...lines) => { for (const l of lines) { log.push(l); console.log(l); } };
const now = () => new Date().toISOString();
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rule = (title) => say("", "-".repeat(78), title, "-".repeat(78));

/* ------------------------------------------------------------ processes --- */
function start(name, file, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(lab, file)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    const timer = setTimeout(() => reject(new Error(`${name} did not start: ${text}`)), 10000);
    child.stdout.on("data", (d) => {
      text += d;
      if (/listening/.test(text)) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on("data", (d) => (text += d));
    child.on("exit", (code) => { clearTimeout(timer); if (!/listening/.test(text)) reject(new Error(`${name} exited ${code}: ${text}`)); });
  });
}
const stop = (child) => new Promise((resolve) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return resolve(); // already gone (a killed child has signalCode, not exitCode)
  child.once("exit", () => resolve());
  child.kill();
});

async function startOrigin(leak) {
  const env = { PORT: String(ORIGIN_PORT), LEAK: leak ? "1" : "0" };
  const c = await start("origin", "origin.mjs", env);
  say(`[${now()}] origin started: node lab/origin.mjs  PORT=${ORIGIN_PORT} LEAK=${leak ? 1 : 0}${leak ? "   <- mistake 1: /account public, max-age=60, no Vary" : ""}`);
  return c;
}
async function startEdge(mode) {
  const c = await start("edge", "edge.mjs", { PORT: String(EDGE_PORT), ORIGIN_PORT: String(ORIGIN_PORT), CACHE_KEY: mode });
  say(`[${now()}] edge started:   node lab/edge.mjs    PORT=${EDGE_PORT} ORIGIN_PORT=${ORIGIN_PORT} CACHE_KEY=${mode}${mode !== "conservative" ? "   <- mistake 2: cookie not in the cache key" : ""}`);
  return c;
}

/* ------------------------------------------------------------- requests --- */
function get(method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: EDGE_PORT, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}
const SHOW = ["cache-control", "vary", "age", "x-cache-status", "x-cache-key-mode", "x-served-to", "x-purged-entries"];
function show(cmd, r) {
  say(`$ ${cmd}`, `HTTP/1.1 ${r.status}`);
  for (const h of SHOW) if (r.headers[h] !== undefined) say(`${h}: ${r.headers[h]}`);
  const signed = r.body.match(/Signed in as <strong>([^<]+)<\/strong> \(([^)]+)\)/);
  if (signed) say(`   body: Signed in as ${signed[1]} (${signed[2]})`);
  else say(`   body: ${r.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)}`);
}
async function account(who, client = "node") {
  const u = USERS[who];
  const cmd = `curl -sS -D - -H 'Cookie: ${u.cookie}' ${EDGE}/account`;
  let r;
  if (client === "curl") {
    const res = spawnSync(process.platform === "win32" ? "curl.exe" : "curl", ["-sS", "-D", "-", "-H", `Cookie: ${u.cookie}`, `${EDGE}/account`], { encoding: "utf8" });
    if (res.error || res.status !== 0) return account(who, "node"); // curl not installed: fall back
    const [head, ...rest] = res.stdout.split(/\r?\n\r?\n/);
    const lines = head.split(/\r?\n/);
    const headers = Object.fromEntries(lines.slice(1).map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]));
    r = { status: Number(lines[0].split(" ")[1]), headers, body: rest.join("\n\n") };
    say(`[${now()}] client: curl (${process.platform === "win32" ? "curl.exe" : "curl"})`);
  } else {
    r = await get("GET", "/account", { Cookie: u.cookie });
    say(`[${now()}] client: node http`);
  }
  show(cmd, r);
  return r;
}
function verdict(who, r) {
  const servedTo = r.headers["x-served-to"];
  if (!servedTo) return say(`=> ${who}: no account page`);
  const owner = Object.entries(USERS).find(([, u]) => u.campusId === servedTo)?.[0];
  if (owner && owner !== who) say(`=> DISCLOSURE: ${who}'s request (Cookie ${USERS[who].cookie}) was answered with ${owner}'s account page (${servedTo}), cache status ${r.headers["x-cache-status"]}`);
  else say(`=> ${who} got ${who}'s own page (${servedTo}), cache status ${r.headers["x-cache-status"]}`);
}
function runGuard() {
  const args = [guard, EDGE, "--path", "/account", "--cookie", USERS.alice.cookie, "--cookie", USERS.bob.cookie, "--personalized"];
  say(`[${now()}] $ node scripts/cache-guard.mjs ${EDGE} --path /account --cookie ${USERS.alice.cookie} --cookie ${USERS.bob.cookie} --personalized`);
  const res = spawnSync(process.execPath, args, { encoding: "utf8" });
  for (const l of (res.stdout + res.stderr).trimEnd().split(/\r?\n/)) say(`  ${l}`);
  say(`=> cache-guard exit code ${res.status} (${res.status === 0 ? "PASS" : res.status === 1 ? "FAIL: the detection fired" : "could not run"})`);
  return res.status;
}
const flush = (file) => { writeFileSync(path.join(out, file), log.join("\n") + "\n"); log = []; };

/* ---------------------------------------------------------------- run ----- */
let origin, edge;
try {
  say(
    "HW5 Task 8 — cache-key confusion causing cross-user disclosure (loopback lab, synthetic users)",
    `run started ${now()} on ${process.platform} ${os.release()}, node ${process.version}`,
    `lab/origin.mjs sha256 ${sha256(path.join(lab, "origin.mjs"))}`,
    `lab/edge.mjs   sha256 ${sha256(path.join(lab, "edge.mjs"))}`,
    "Both servers bind 127.0.0.1 only. Users are the lab's synthetic fixtures: sid-alice (S0198442), sid-bob (S0207731).",
    "",
    "Mistake 1 (origin): /account advertised `public, max-age=60` and its `Vary: Cookie` dropped   -> LEAK=1",
    "Mistake 2 (edge):   the cache key does not include the session cookie                       -> CACHE_KEY=vary-only",
  );

  rule("A. Safe baseline: LEAK=0, CACHE_KEY=conservative");
  origin = await startOrigin(false);
  edge = await startEdge("conservative");
  verdict("alice", await account("alice"));
  verdict("bob", await account("bob"));
  await stop(edge); await stop(origin);

  rule("B. Mistake 1 alone: LEAK=1, CACHE_KEY=conservative (the cookie is still in the key)");
  origin = await startOrigin(true);
  edge = await startEdge("conservative");
  verdict("alice", await account("alice"));
  verdict("bob", await account("bob"));
  await stop(edge);

  rule("C. Both mistakes: LEAK=1, CACHE_KEY=vary-only");
  edge = await startEdge("vary-only");
  verdict("alice", await account("alice"));
  await sleep(2000); // so the Age header shows Bob is handed a stored copy
  verdict("bob", await account("bob"));

  rule("D. Detection, run while the leak is live");
  runGuard();
  say("", `run paused ${now()}; cleanup continues in cleanup.txt with the same edge process (its cache still holds Alice's page)`);
  flush("repro.txt");

  /* ------------------------------------------------------------ cleanup --- */
  say(
    "HW5 Task 8 — cleanup, and proof that it worked",
    `continued ${now()}; the edge from repro.txt section C is still running, with Alice's page stored under GET /account`,
  );
  rule("1. Revert the origin header (restart origin with LEAK=0). The edge cache is untouched.");
  await stop(origin);
  origin = await startOrigin(false);
  await sleep(2000);
  const stillBob = await account("bob");
  verdict("bob", stillBob);
  say(stillBob.headers["x-cache-status"] === "HIT"
    ? "=> Reverting the origin is NOT enough: the already-stored copy of Alice's page is still served until it expires or is purged."
    : `=> (stored copy no longer served: ${stillBob.headers["x-cache-status"]})`);

  rule("2. Purge the affected path (all variants)");
  const purge = await get("PURGE", "/account");
  show(`curl -sS -D - -X PURGE ${EDGE}/account`, purge);

  rule("3. Re-request as both users, from two different clients");
  verdict("alice", await account("alice", "node"));
  verdict("bob", await account("bob", "curl"));
  verdict("bob", await account("bob", "node"));
  verdict("alice", await account("alice", "curl"));
  say("=> BYPASS means the edge did not store the page at all (the origin says private, no-store) — stricter than a fresh MISS.");

  rule("4. Revert the cache key (restart edge with CACHE_KEY=conservative)");
  await stop(edge);
  edge = await startEdge("conservative");
  say("   Note: this lab edge keeps its cache in memory, so a restart would also have emptied it. A real CDN keeps its");
  say("   cache across rule changes, which is why the purge (step 2) was done and verified before this step.");
  verdict("alice", await account("alice"));
  verdict("bob", await account("bob", "curl"));

  rule("5. Detection after cleanup");
  runGuard();

  rule("6. Invalidate the synthetic sessions");
  await stop(edge); await stop(origin);
  say(`[${now()}] edge and origin stopped. sid-alice and sid-bob exist only inside the running lab origin (fixtures in origin.mjs),`);
  say("   so they are gone with it. The same request now gets no answer at all:");
  try {
    await get("GET", "/account", { Cookie: USERS.alice.cookie });
    say("   unexpected: something still answered on the edge port");
  } catch (error) {
    say(`$ curl -sS -H 'Cookie: ${USERS.alice.cookie}' ${EDGE}/account`, `   ${error.code || error.message}`);
  }
  say("", "Limits of this lab: both clients are on 127.0.0.1, so they are two clients, not two network locations;");
  say("the edge binds loopback only. Production (reel.miniexhibit.app) was not touched.", "", `run finished ${now()}`);
  flush("cleanup.txt");
  console.log(`\nwrote ${path.join(out, "repro.txt")} and cleanup.txt`);
} catch (error) {
  console.error(error);
  process.exitCode = 2;
} finally {
  await stop(edge);
  await stop(origin);
}
