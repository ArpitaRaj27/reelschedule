import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, configureAuth, describeError, query } from "../src/lib/api";
import { json } from "./fixtures";

afterEach(() => configureAuth(() => null, () => {}));

describe("API client", () => {
  it("turns the server's error shape into an ApiError with field errors and request id", async () => {
    vi.stubGlobal("fetch", async () =>
      json({ error: { code: "validation_failed", message: "Invalid", details: [{ field: "startsAt", message: "Use an ISO date-time" }], requestId: "req-42" } }, 400),
    );
    const err = (await api("/api/screenings", { method: "POST", body: {} }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "validation_failed", requestId: "req-42" });
    expect(err.fieldErrors()).toEqual({ startsAt: "Use an ISO date-time" });
  });

  it("reports an unreachable server as network_error with plain wording", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await api("/api/screenings").catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: "network_error" });
    expect(describeError(err)).toMatch(/can't reach the schedule server/i);
  });

  it("attaches the token only to signed-in requests and signs out on 401", async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return json({ error: { code: "invalid_token", message: "expired" } }, 401);
    });
    const unauthorized = vi.fn();
    configureAuth(() => "tok-123", unauthorized);
    await api("/api/screenings").catch(() => {});
    await api("/api/me", { auth: true }).catch(() => {});
    expect(seen).toEqual([null, "Bearer tok-123"]);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it("builds query strings without empty values", () => {
    expect(query({ q: "harbor", date: "", roomId: undefined, page: 2 })).toBe("?q=harbor&page=2");
    expect(query({})).toBe("");
  });
});
