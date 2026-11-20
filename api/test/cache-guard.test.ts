import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, SCOPES } from "../src/auth.js";
import { IDS } from "../scripts/seed.js";
import { makeApp, resetDatabase, token, type TestContext } from "./helpers.js";

// HW5 Task 8, the prevention half of the cache-disclosure detection.
// Cloudflare keys its cache on the URL, so on reel.miniexhibit.app the origin's header is the only thing that keeps one
// signed-in user's response away from the next person who asks for the same URL. Every GET route under /api, found by
// walking the router so a new route is covered without editing this file, must answer a request that carries credentials
// with a response no shared cache may store. If this fails, CI fails, and Render (which deploys only after the checks
// pass) never ships the mistake. scripts/cache-guard.mjs checks the same rule from outside, through Cloudflare.

/** Routes this test does not request, and why. A new route is never skipped silently. */
const NOT_REQUESTED: Record<string, string> = {
  "/api/events": "a server-sent event stream that never ends; it sends Cache-Control: no-store (src/events.ts)",
};

/** Fill route parameters with real seeded ids where one exists, so most requests reach the handler and answer 200. */
function concrete(path: string): string {
  if (path === "/api/rooms/:id/schedule") return `/api/rooms/${IDS.rooms.loft}/schedule`;
  if (path === "/api/films/search") return "/api/films/search?q=harbor";
  return path.replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000");
}

let t: TestContext;
let routes: string[];
const identities: Record<string, string> = {};

beforeAll(async () => {
  t = await makeApp();
  await resetDatabase();
  identities.programmer = await token(t.keys, { sub: "cache-guard-programmer" });
  identities.viewer = await token(t.keys, { roles: [ROLES.viewer], scp: SCOPES.read, sub: "cache-guard-viewer" });
  const stack = (t.app as unknown as { router: { stack: { route?: { path: unknown; methods: Record<string, boolean> } }[] } }).router.stack;
  routes = stack
    .filter((l) => l.route && typeof l.route.path === "string" && l.route.path.startsWith("/api/") && l.route.methods.get)
    .map((l) => l.route!.path as string);
});
afterAll(async () => t.close());

describe("credentialed responses never go to a shared cache", () => {
  it("finds the API's GET routes, including the signed-in ones", () => {
    expect(routes).toEqual(expect.arrayContaining(["/api/me", "/api/films/search", "/api/screenings", "/api/screenings/:id", "/api/status"]));
    expect(routes.length).toBeGreaterThanOrEqual(12);
  });

  it("answers every GET route under /api, for a programmer and a viewer, with private/no-store and no CDN-Cache-Control", async () => {
    const problems: string[] = [];
    let ok200 = 0;
    for (const route of routes) {
      if (NOT_REQUESTED[route]) continue;
      for (const [who, tok] of Object.entries(identities)) {
        const res = await request(t.app).get(concrete(route)).set("Authorization", `Bearer ${tok}`);
        if (res.status === 200) ok200++;
        const cc = String(res.headers["cache-control"] ?? "");
        if (!/\b(private|no-store)\b/.test(cc) || /\bpublic\b|s-maxage/.test(cc)) problems.push(`${route} as ${who} (${res.status}): Cache-Control "${cc}"`);
        if (res.headers["cdn-cache-control"]) problems.push(`${route} as ${who} (${res.status}): CDN-Cache-Control "${res.headers["cdn-cache-control"]}"`);
      }
    }
    expect(problems).toEqual([]);
    expect(ok200).toBeGreaterThanOrEqual(10); // the rule was checked on real answers, not only on errors
  });

  it("still lets anonymous requests to public routes be cached (the guard is about credentials, not about turning caching off)", async () => {
    const res = await request(t.app).get("/api/screenings");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("s-maxage");
    expect(res.headers["cdn-cache-control"]).toBeDefined();
  });
});
