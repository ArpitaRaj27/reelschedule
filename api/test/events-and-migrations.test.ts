import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { appliedVersions, migrateDown, migrateUp } from "../src/migrator.js";
import { IDS } from "../scripts/seed.js";
import { makeApp, resetDatabase, TEST_DB, token, type TestContext } from "./helpers.js";

/** Read SSE frames from a live HTTP connection until `count` change events arrive. */
async function collect(url: string, count: number, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: { id: number; type: string }[] = [];
  const deadline = Date.now() + 5000;
  while (events.length < count && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data: "));
      if (frame.includes("event: change") && data) events.push(JSON.parse(data.slice(6)));
    }
  }
  controller.abort();
  return events;
}

describe("live updates (SSE) with replay", () => {
  let t: TestContext;
  let server: Server;
  let base: string;
  let auth: Record<string, string>;

  beforeAll(async () => {
    await resetDatabase();
    t = await makeApp();
    server = t.app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    auth = { Authorization: `Bearer ${await token(t.keys)}` };
  });
  afterAll(async () => {
    server.closeAllConnections();
    server.close();
    await t.close();
  });

  it("pushes committed changes to connected clients", async () => {
    const pending = collect(`${base}/api/events`, 1);
    await new Promise((r) => setTimeout(r, 150));
    const created = await request(t.app).post("/api/screenings").set(auth).send({ filmId: IDS.films.hours, roomId: IDS.rooms.gallery, startsAt: "2026-11-23T10:00:00-06:00" });
    const events = await pending;
    expect(events[0]).toMatchObject({ type: "screening.created", screeningId: created.body.id });
  });

  it("a disconnected client replays exactly the events it missed (no loss, no duplicates)", async () => {
    const before = await t.db.query<{ max: number }>("SELECT max(id)::int AS max FROM change_events");
    const lastSeen = before.rows[0]!.max;
    // While "disconnected", three changes happen.
    const ids: string[] = [];
    for (const hh of ["12", "14", "16"]) {
      const r = await request(t.app).post("/api/screenings").set(auth).send({ filmId: IDS.films.hours, roomId: IDS.rooms.gallery, startsAt: `2026-11-23T${hh}:00:00-06:00` });
      ids.push(r.body.id);
    }
    const replayed = await collect(`${base}/api/events`, 3, { "Last-Event-ID": String(lastSeen) });
    expect(replayed.map((e) => e.id)).toEqual([lastSeen + 1, lastSeen + 2, lastSeen + 3]);
    expect(new Set(replayed.map((e) => e.id)).size).toBe(3);
  });

  it("concurrent writes reach a live client in strictly increasing id order, once each", async () => {
    const pending = collect(`${base}/api/events`, 4);
    await new Promise((r) => setTimeout(r, 150));
    await Promise.all(
      ["10", "12", "14", "16"].map((hh) =>
        request(t.app).post("/api/screenings").set(auth).send({ filmId: IDS.films.hours, roomId: IDS.rooms.studio, startsAt: `2026-11-24T${hh}:00:00-06:00` }),
      ),
    );
    const ids = (await pending).map((e) => e.id);
    expect(ids).toHaveLength(4);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(4);
  });

  it("a fresh client gets a ready event carrying an id, so the browser's own reconnect can resume", async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: ready")) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    expect(text).toMatch(/id: \d+\nevent: ready/);
  });
});

describe("versioned, reversible migrations", () => {
  it("rolls back every migration and re-applies them cleanly", async () => {
    await resetDatabase();
    const db = createPool(TEST_DB);
    try {
      expect(await appliedVersions(db)).toEqual(["001_core_schema", "002_audit_and_change_events", "003_provider_cache", "004_rum_vitals"]);
      // Reverse the latest migration and prove its table is gone…
      await migrateDown(db, 1);
      await expect(db.query("SELECT 1 FROM rum_vitals")).rejects.toThrow(/does not exist/);
      // …then every migration, then forward again.
      await migrateDown(db, 3);
      expect(await appliedVersions(db)).toEqual([]);
      await migrateUp(db);
      expect(await appliedVersions(db)).toHaveLength(4);
      await db.query("SELECT 1 FROM rum_vitals");
    } finally {
      await db.end();
    }
  });
});
