import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ROLES, SCOPES } from "../src/auth.js";
import { IDS } from "../scripts/seed.js";
import { makeApp, resetDatabase, token, type TestContext } from "./helpers.js";

let t: TestContext;
let programmer: string;
let programmer2: string;
let viewer: string;
let readOnlyProgrammer: string;

beforeAll(async () => {
  t = await makeApp();
  programmer = await token(t.keys, { sub: "prog-1" });
  programmer2 = await token(t.keys, { sub: "prog-2" });
  viewer = await token(t.keys, { roles: [ROLES.viewer], scp: SCOPES.read, sub: "viewer-1" });
  readOnlyProgrammer = await token(t.keys, { scp: SCOPES.read, sub: "prog-ro" });
});
afterAll(async () => t.close());
beforeEach(async () => resetDatabase());

const bearer = (tok: string) => ({ Authorization: `Bearer ${tok}` });
const newScreening = (start: string, film = IDS.films.harbor, room = IDS.rooms.loft) => ({
  filmId: film,
  roomId: room,
  startsAt: start,
});

describe("public catalog", () => {
  it("lists seeded screenings with a public, short shared-cache policy", async () => {
    const res = await request(t.app).get("/api/screenings");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(8);
    expect(res.headers["cache-control"]).toBe("public, max-age=0, s-maxage=10");
    // Only the CDN may serve a stale copy while refreshing; browsers always revalidate.
    expect(res.headers["cdn-cache-control"]).toBe("max-age=10, stale-while-revalidate=20, stale-if-error=600");
    expect(res.headers.etag).toBeTruthy();
  });

  it("ignores the live clients' ?v= cache key", async () => {
    const res = await request(t.app).get("/api/screenings").query({ v: 17, date: "2026-11-21" });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  it("filters by text, date, room, genre and status", async () => {
    const byText = await request(t.app).get("/api/screenings").query({ q: "harbor" });
    expect(byText.body.items.every((s: { film: { title: string } }) => s.film.title === "The Quiet Harbor")).toBe(true);
    expect(byText.body.count).toBe(2);

    const byDate = await request(t.app).get("/api/screenings").query({ date: "2026-11-21" });
    expect(byDate.body.count).toBe(3);

    const byRoom = await request(t.app).get("/api/screenings").query({ roomId: IDS.rooms.main });
    expect(byRoom.body.count).toBe(4);

    const byGenre = await request(t.app).get("/api/screenings").query({ genre: "comedy" });
    expect(byGenre.body.count).toBe(2);

    const none = await request(t.app).get("/api/screenings").query({ q: "no such film" });
    expect(none.body).toMatchObject({ count: 0, items: [] });
  });

  it("rejects invalid filters with the standard error shape", async () => {
    const res = await request(t.app).get("/api/screenings").query({ date: "not-a-date", status: "maybe" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(["date", "status"]);
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("returns 404 for unknown ids and routes", async () => {
    expect((await request(t.app).get("/api/screenings/not-a-uuid")).status).toBe(404);
    expect((await request(t.app).get("/api/screenings/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await request(t.app).get("/api/nope")).body.error.code).toBe("not_found");
  });

  it("marks authenticated responses private, no-store", async () => {
    const res = await request(t.app).get("/api/screenings").set(bearer(viewer));
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("allows only the exact allowlisted origin for CORS", async () => {
    const ok = await request(t.app).options("/api/screenings").set("Origin", "https://festival.example").set("Access-Control-Request-Method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe("https://festival.example");
    const bad = await request(t.app).options("/api/screenings").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reports release identity on /healthz", async () => {
    const res = await request(t.app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: "up", commit: "test-sha" });
  });

  it("publishes festival metadata (time zone, default buffer, festival days)", async () => {
    const res = await request(t.app).get("/api/meta");
    expect(res.body).toEqual({
      festivalName: "Lakeshore Film Festival",
      timezone: "America/Chicago",
      defaultBufferMinutes: 15,
      days: ["2026-11-20", "2026-11-21", "2026-11-22"],
    });
  });
});

describe("authorization (validated token claims, not hidden buttons)", () => {
  const body = newScreening("2026-11-23T10:00:00-06:00");

  it("401 without a token", async () => {
    const res = await request(t.app).post("/api/screenings").send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("403 for a viewer", async () => {
    const res = await request(t.app).post("/api/screenings").set(bearer(viewer)).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("403 for a programmer whose token lacks the write scope", async () => {
    const res = await request(t.app).post("/api/screenings").set(bearer(readOnlyProgrammer)).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("insufficient_scope");
  });

  it("401 for wrong audience, wrong issuer, expired, or wrongly signed tokens", async () => {
    const bad = [
      await token(t.keys, { aud: "api://some-other-api" }),
      await token(t.keys, { iss: "https://attacker.example" }),
      await token(t.keys, { exp: Math.floor(Date.now() / 1000) - 120 }),
      await token(t.keys, { signWith: t.keys.otherKey }),
      "not.a.jwt",
    ];
    for (const tok of bad) {
      const res = await request(t.app).post("/api/screenings").set(bearer(tok)).send(body);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("invalid_token");
    }
  });

  it("201 for a programmer with the write scope, audited with the token's subject", async () => {
    const res = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(body);
    expect(res.status).toBe(201);
    const audit = await t.db.query("SELECT actor_sub, action, before, after FROM audit_events");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_sub: "prog-1", action: "screening.created", before: null });
    expect(audit.rows[0].after.id).toBe(res.body.id);
  });

  it("/api/me reflects validated claims", async () => {
    const res = await request(t.app).get("/api/me").set(bearer(viewer));
    expect(res.body).toMatchObject({ sub: "viewer-1", roles: [ROLES.viewer], canProgram: false });
  });
});

describe("scheduling rules", () => {
  it("creates a screening: 201 + Location + calculated end and occupied-until", async () => {
    const res = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T18:00:00-06:00"));
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/screenings/${res.body.id}`);
    expect(res.body).toMatchObject({ runtimeMinutes: 105, bufferMinutes: 15, status: "scheduled", version: 1 });
    expect(res.body.endsAt).toBe(new Date("2026-11-23T19:45:00-06:00").toISOString());
    expect(res.body.occupiedUntil).toBe(new Date("2026-11-23T20:00:00-06:00").toISOString());
  });

  it("returns 400 field errors for invalid input", async () => {
    const res = await request(t.app).post("/api/screenings").set(bearer(programmer)).send({ filmId: "x", startsAt: "tomorrow" });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(["filmId", "roomId", "startsAt"]);
  });

  it("returns 400 runtime_missing for a film with no runtime", async () => {
    const res = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T10:00:00-06:00", IDS.films.shorts));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("runtime_missing");
  });

  it("19:50 conflicts with an 18:00 screening (105 + 15); 20:00 is allowed", async () => {
    const first = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T18:00:00-06:00"));
    expect(first.status).toBe(201);
    const clash = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T19:50:00-06:00", IDS.films.orchard));
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("schedule_conflict");
    expect(clash.body.error.details.conflicts[0].id).toBe(first.body.id);
    const next = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T20:00:00-06:00", IDS.films.orchard));
    expect(next.status).toBe(201);
  });

  it("preview shows the interval and conflicts without writing", async () => {
    await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T18:00:00-06:00"));
    const res = await request(t.app).post("/api/screenings/preview").set(bearer(readOnlyProgrammer)).send(newScreening("2026-11-23T19:50:00-06:00", IDS.films.orchard));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.conflicts).toHaveLength(1);
    const count = await t.db.query("SELECT count(*)::int AS n FROM screenings WHERE room_id = $1", [IDS.rooms.loft]);
    expect(count.rows[0].n).toBe(2); // 1 seeded + 1 created; preview wrote nothing
  });

  it("Game Day: two programmers book the same slot at once → exactly one 201 and one 409", async () => {
    const body = newScreening("2026-11-24T15:00:00-06:00");
    const [a, b] = await Promise.all([
      request(t.app).post("/api/screenings").set(bearer(programmer)).send(body),
      request(t.app).post("/api/screenings").set(bearer(programmer2)).send({ ...body, filmId: IDS.films.orchard }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const rows = await t.db.query("SELECT count(*)::int AS n FROM screenings WHERE starts_at = $1", [body.startsAt]);
    expect(rows.rows[0].n).toBe(1);
    const audit = await t.db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'screening.created'");
    expect(audit.rows[0].n).toBe(1); // no audit record for the rejected write
  });

  it("reschedules with optimistic concurrency and keeps the saved runtime snapshot", async () => {
    const created = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T10:00:00-06:00"));
    // The provider's runtime changes after scheduling…
    await t.db.query("UPDATE film_references SET runtime_minutes = 150 WHERE id = $1", [IDS.films.harbor]);
    const moved = await request(t.app)
      .patch(`/api/screenings/${created.body.id}`)
      .set(bearer(programmer))
      .send({ version: 1, startsAt: "2026-11-23T11:00:00-06:00" });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ version: 2, runtimeMinutes: 105 }); // snapshot, not 150
    expect(moved.body.occupiedUntil).toBe(new Date("2026-11-23T13:00:00-06:00").toISOString());

    const stale = await request(t.app)
      .patch(`/api/screenings/${created.body.id}`)
      .set(bearer(programmer2))
      .send({ version: 1, startsAt: "2026-11-23T12:00:00-06:00" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "stale_version", details: { currentVersion: 2 } });
  });

  it("cancels a screening, frees the slot, and records before/after audit", async () => {
    const created = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T18:00:00-06:00"));
    const canceled = await request(t.app)
      .post(`/api/screenings/${created.body.id}/cancel`)
      .set(bearer(programmer))
      .send({ version: 1, reason: "Print damaged in transit" });
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe("canceled");
    const again = await request(t.app).post(`/api/screenings/${created.body.id}/cancel`).set(bearer(programmer)).send({ version: 2, reason: "twice" });
    expect(again.body.error.code).toBe("invalid_state");
    const reuse = await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T18:30:00-06:00", IDS.films.orchard));
    expect(reuse.status).toBe(201);
    const audit = await t.db.query("SELECT before->>'status' AS b, after->>'status' AS a, after->>'reason' AS r FROM audit_events WHERE action = 'screening.canceled'");
    expect(audit.rows[0]).toEqual({ b: "scheduled", a: "canceled", r: "Print damaged in transit" });
  });

  it("audit rows are append-only at the database level", async () => {
    await request(t.app).post("/api/screenings").set(bearer(programmer)).send(newScreening("2026-11-23T18:00:00-06:00"));
    await expect(t.db.query("UPDATE audit_events SET actor_sub = 'someone-else'")).rejects.toThrow(/append-only/);
    await expect(t.db.query("DELETE FROM audit_events")).rejects.toThrow(/append-only/);
  });
});

describe("rate limiting", () => {
  it("returns 429 with the standard error shape after the write limit", async () => {
    const limited = await makeApp({ limits: { writesPerMinute: 2, providerPerMinute: 1000 } });
    try {
      const tok = await token(limited.keys, { sub: "prog-rl" });
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await request(limited.app).post("/api/screenings").set(bearer(tok)).send(newScreening(`2026-11-25T1${i * 2}:00:00-06:00`, IDS.films.hours, IDS.rooms.gallery));
        statuses.push(res.status);
        if (res.status === 429) expect(res.body.error.code).toBe("rate_limited");
      }
      expect(statuses).toEqual([201, 201, 429]);
    } finally {
      await limited.close();
    }
  });
});
