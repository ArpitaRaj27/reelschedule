import { describe, expect, it } from "vitest";
import { HttpError } from "../src/errors.js";
import { computeInterval, overlaps } from "../src/schedule.js";

// Hand-predicted BEFORE running (project brief):
//   18:00 start + 105 min runtime = 19:45 end; + 15 min buffer → room occupied until 20:00.
//   A 19:50 screening conflicts. A 20:00 screening is allowed.
describe("core calculation: screening interval", () => {
  const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00-06:00`);

  it("18:00 + 105 min + 15 min buffer occupies the room until 20:00", () => {
    const iv = computeInterval(at("18:00"), 105, 15);
    expect(iv.endsAt.toISOString()).toBe(at("19:45").toISOString());
    expect(iv.occupiedUntil.toISOString()).toBe(at("20:00").toISOString());
  });

  it("a 19:50 screening conflicts", () => {
    const first = computeInterval(at("18:00"), 105, 15);
    const second = computeInterval(at("19:50"), 90, 15);
    expect(overlaps(first, second)).toBe(true);
  });

  it("a 20:00 screening is allowed (half-open intervals)", () => {
    const first = computeInterval(at("18:00"), 105, 15);
    const second = computeInterval(at("20:00"), 90, 15);
    expect(overlaps(first, second)).toBe(false);
  });

  it("a screening that ends before another starts does not conflict", () => {
    expect(overlaps(computeInterval(at("10:00"), 60, 0), computeInterval(at("11:00"), 60, 0))).toBe(false);
  });

  it("treats a missing runtime as a validation problem, never zero minutes", () => {
    for (const runtime of [null, undefined, 0, -5]) {
      try {
        computeInterval(at("18:00"), runtime as number | null, 15);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).code).toBe("runtime_missing");
        expect((err as HttpError).status).toBe(400);
      }
    }
  });

  it("rejects buffers outside 0–120 minutes", () => {
    expect(() => computeInterval(at("18:00"), 100, -1)).toThrow(HttpError);
    expect(() => computeInterval(at("18:00"), 100, 121)).toThrow(HttpError);
  });
});
