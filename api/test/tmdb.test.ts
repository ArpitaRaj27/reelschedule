import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLogSink } from "../src/logger.js";
import { makeApp, resetDatabase, token, type TestContext } from "./helpers.js";

/** Stubbed TMDB: no real network calls; each test scripts the provider's behaviour. */
type Script = (url: string) => Response | Promise<Response>;

function stub(script: Script) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get("authorization") });
    return script(url);
  };
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const SEARCH_OK = { results: [{ id: 603, title: "Sample Film", release_date: "1999-03-31", poster_path: "/p.jpg" }] };
const MOVIE_OK = { id: 603, title: "Sample Film", runtime: 136, genres: [{ id: 1, name: "Science Fiction" }], release_date: "1999-03-31", poster_path: "/p.jpg" };
const timeout = () => {
  throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
};

let t: TestContext | undefined;
let logs: string[] = [];
beforeEach(async () => {
  await resetDatabase();
  logs = [];
  setLogSink((l) => logs.push(l));
});
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(script: Script) {
  const s = stub(script);
  t = await makeApp({ fetchImpl: s.fetchImpl });
  const tok = await token(t.keys);
  return { ...s, app: t.app, auth: { Authorization: `Bearer ${tok}` } };
}

describe("TMDB integration (stubbed)", () => {
  it("validates, caches, and sends the credential only as a header", async () => {
    const { app, auth, calls } = await setup(() => json(SEARCH_OK));
    const first = await request(app).get("/api/films/search").query({ q: "Sample" }).set(auth);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ stale: false, items: [{ tmdbId: 603, title: "Sample Film", releaseYear: 1999 }] });
    const second = await request(app).get("/api/films/search").query({ q: "sample" }).set(auth);
    expect(second.status).toBe(200);
    expect(calls).toHaveLength(1); // second request served from the provider cache
    expect(calls[0]!.auth).toBe("Bearer test-tmdb-secret-token");
    expect(calls[0]!.url).not.toContain("test-tmdb-secret-token");
  });

  it("retries a bounded number of times on timeout, then answers 503 with no cache", async () => {
    const { app, auth, calls } = await setup(timeout);
    const res = await request(app).get("/api/films/search").query({ q: "Sample" }).set(auth);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("provider_unavailable");
    expect(calls).toHaveLength(3); // 1 attempt + 2 retries (TMDB_MAX_RETRIES=2)
  });

  it("does not retry a 4xx and maps an unknown film to 404", async () => {
    const { app, auth, calls } = await setup(() => json({ status_message: "not found" }, 404));
    const res = await request(app).post("/api/films/import").send({ tmdbId: 999999 }).set(auth);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("serves a labelled stale copy during an outage", async () => {
    let up = true;
    const { app, auth } = await setup(() => (up ? json(SEARCH_OK) : timeout()));
    await request(app).get("/api/films/search").query({ q: "Sample" }).set(auth);
    await t!.db.query("UPDATE provider_cache SET expires_at = now() - interval '1 minute'");
    up = false;
    const res = await request(app).get("/api/films/search").query({ q: "Sample" }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(res.body.fetchedAt).toBeTruthy();
  });

  it("treats a malformed provider response as a failure (runtime validation)", async () => {
    const { app, auth } = await setup(() => json({ results: [{ id: "not-a-number" }] }));
    const res = await request(app).get("/api/films/search").query({ q: "Sample" }).set(auth);
    expect(res.status).toBe(503);
  });

  it("imports a film with its runtime; 0 runtime from TMDB is stored as unknown", async () => {
    const { app, auth } = await setup((url) => json(url.includes("/movie/604") ? { ...MOVIE_OK, id: 604, runtime: 0 } : MOVIE_OK));
    const ok = await request(app).post("/api/films/import").send({ tmdbId: 603 }).set(auth);
    expect(ok.status).toBe(201);
    expect(ok.body.film).toMatchObject({ tmdbId: 603, runtimeMinutes: 136, genres: ["Science Fiction"] });
    const zero = await request(app).post("/api/films/import").send({ tmdbId: 604 }).set(auth);
    expect(zero.body.film.runtimeMinutes).toBeNull();
  });

  it("keeps the schedule usable while TMDB is down", async () => {
    const { app } = await setup(timeout);
    const res = await request(app).get("/api/screenings");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(8);
  });

  it("never writes the credential to logs", async () => {
    const { app, auth } = await setup(timeout);
    await request(app).get("/api/films/search").query({ q: "Sample" }).set(auth);
    const all = logs.join("\n");
    expect(all).toContain("tmdb_attempt_failed");
    expect(all).not.toContain("test-tmdb-secret-token");
  });
});
