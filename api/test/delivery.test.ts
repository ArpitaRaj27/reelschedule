import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STATUS_CACHE_KEY } from "../src/app.js";
import { TtlCache } from "../src/appCache.js";
import { IDS } from "../scripts/seed.js";
import { makeApp, resetDatabase, token, type TestContext } from "./helpers.js";

// HW5 "Own the Edge": per-content-class cache headers, the app-layer cache, and the RUM collector.

let t: TestContext;
let cache: TtlCache;
let dist: string;
let auth: Record<string, string>;

beforeAll(async () => {
  dist = mkdtempSync(path.join(tmpdir(), "reel-dist-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), '<!doctype html><title>ReelSchedule</title><script type="module" src="/assets/index-abc123.js"></script>');
  writeFileSync(path.join(dist, "assets", "index-abc123.js"), "console.log('app')");
  writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");
  cache = new TtlCache();
  t = await makeApp({ webDist: dist, cache });
  auth = { Authorization: `Bearer ${await token(t.keys)}` };
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDatabase();
  cache.invalidate();
});

describe("web app served from the API origin", () => {
  it("serves the HTML shell: browsers revalidate, the CDN may keep it 30 s, strict CSP", async () => {
    const res = await request(t.app).get("/").set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>ReelSchedule</title>");
    expect(res.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(res.headers["cdn-cache-control"]).toBe("max-age=30");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers.etag).toBeTruthy();
  });

  it("answers a conditional request for the shell with 304 and no body", async () => {
    const first = await request(t.app).get("/").set("Accept", "text/html");
    const again = await request(t.app).get("/").set("Accept", "text/html").set("If-None-Match", first.headers.etag!);
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
  });

  it("serves the shell for app routes (deep links) but not for API or well-known paths", async () => {
    const deep = await request(t.app).get("/screenings/123").set("Accept", "text/html");
    expect(deep.status).toBe(200);
    expect(deep.text).toContain("<title>ReelSchedule</title>");
    const api = await request(t.app).get("/api/nope").set("Accept", "text/html");
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe("not_found");
  });

  it("caches hashed assets for a year (immutable) and 404s a missing asset instead of returning HTML", async () => {
    const asset = await request(t.app).get("/assets/index-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const missing = await request(t.app).get("/assets/index-old999.js").set("Accept", "*/*");
    expect(missing.status).toBe(404);
    expect(missing.headers["content-type"]).toMatch(/json/);
    expect(missing.headers["cache-control"]).toBe("no-store");
  });

  it("keeps the strict API CSP on JSON responses", async () => {
    const res = await request(t.app).get("/api/meta");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});

describe("/api/status behind the app-layer cache (cache-aside)", () => {
  it("MISS → HIT → (write) → MISS, with the public edge policy", async () => {
    const first = await request(t.app).get("/api/status");
    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(first.headers["cache-control"]).toBe("public, max-age=0, s-maxage=10");
    expect(first.headers["cdn-cache-control"]).toBe("max-age=10, stale-while-revalidate=20, stale-if-error=600");
    expect(first.body.totals).toMatchObject({ scheduled: 8, rooms: 4 });

    const second = await request(t.app).get("/api/status");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body).toEqual(first.body);

    const created = await request(t.app)
      .post("/api/screenings")
      .set(auth)
      .send({ filmId: IDS.films.hours, roomId: IDS.rooms.gallery, startsAt: "2026-11-23T10:00:00-06:00" });
    expect(created.status).toBe(201);

    const third = await request(t.app).get("/api/status");
    expect(third.headers["x-cache"]).toBe("MISS");
    expect(third.body.totals.scheduled).toBe(9);
  });

  it("loads once for a burst of concurrent misses (single flight)", async () => {
    const before = cache.misses;
    const results = await Promise.all(Array.from({ length: 5 }, () => request(t.app).get("/api/status")));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(cache.misses - before).toBe(5);
    expect(results.filter((r) => r.headers["x-cache"] === "MISS")).toHaveLength(5);
    // …but only one entry was loaded and stored:
    expect((await request(t.app).get("/api/status")).headers["x-cache"]).toBe("HIT");
    expect(STATUS_CACHE_KEY).toBe("status:v1");
  });

  it("lists what's next, in start order", async () => {
    const res = await request(t.app).get("/api/status");
    const starts = res.body.nextUp.map((s: { startsAt: string }) => s.startsAt);
    expect(starts).toEqual([...starts].sort());
    expect(res.body.nextUp.length).toBeLessThanOrEqual(5);
  });
});

describe("/api/now", () => {
  it("returns the festival clock with a 2-second edge TTL; the body changes so it never revalidates", async () => {
    const a = await request(t.app).get("/api/now");
    expect(a.headers["cache-control"]).toBe("public, max-age=0");
    expect(a.headers["cdn-cache-control"]).toBe("max-age=2");
    expect(a.body).toMatchObject({ timezone: "America/Chicago" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await request(t.app).get("/api/now");
    expect(b.body.now).not.toBe(a.body.now);
    expect(b.headers.etag).not.toBe(a.headers.etag);
  });
});

describe("/api/vitals (RUM pilot collector)", () => {
  const beacon = (over: Record<string, unknown> = {}) => ({
    name: "LCP",
    value: 1834.2,
    rating: "good",
    id: "v5-1700000000000-1",
    pageViewId: "pv-abc",
    navigationType: "navigate",
    effectiveType: "4g",
    viewport: "1440x900",
    target: "h1",
    ...over,
  });

  it("accepts a valid beacon with 202 and keeps only the latest report per page view + metric id", async () => {
    expect((await request(t.app).post("/api/vitals").send(beacon())).status).toBe(202);
    expect((await request(t.app).post("/api/vitals").send(beacon({ value: 2100 }))).status).toBe(202);
    const rows = await t.db.query("SELECT value, cohort FROM rum_vitals");
    expect(rows.rows).toEqual([{ value: 2100, cohort: "desktop" }]);
  });

  it("rejects bad input with field errors and never stores it", async () => {
    const res = await request(t.app).post("/api/vitals").send(beacon({ name: "FID", value: -1, viewport: "huge" }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(["name", "value", "viewport"]);
    expect((await t.db.query("SELECT count(*)::int AS n FROM rum_vitals")).rows[0].n).toBe(0);
  });

  it("summarises p75 per cohort (desktop and mobile separately)", async () => {
    const values = [1000, 2000, 3000, 4000];
    for (const [i, v] of values.entries()) await request(t.app).post("/api/vitals").send(beacon({ id: `d${i}`, pageViewId: `pv${i}`, value: v }));
    await request(t.app).post("/api/vitals").send(beacon({ id: "m1", pageViewId: "pvm", value: 5000, viewport: "390x844" }));
    const res = await request(t.app).get("/api/vitals/summary");
    expect(res.headers["cache-control"]).toBe("no-store");
    // Nearest rank: sorted[ceil(4 × 0.75) − 1] = sorted[2] = 3000 (hand-computed before running).
    expect(res.body.rows).toEqual([
      { cohort: "desktop", name: "LCP", n: 4, pageViews: 4, p75: 3000 },
      { cohort: "mobile", name: "LCP", n: 1, pageViews: 1, p75: 5000 },
    ]);
  });
});
