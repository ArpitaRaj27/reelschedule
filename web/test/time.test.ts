import { describe, expect, it } from "vitest";
import { clockTime, formatDay, formatDuration, isoDay, minutesFromDayStart, zonedToIso } from "../src/lib/time";

const TZ = "America/Chicago";

describe("festival-local time", () => {
  it("turns a festival day and time into an ISO string with the right offset", () => {
    expect(zonedToIso("2026-11-20", "18:00", TZ)).toBe("2026-11-20T18:00:00-06:00"); // CST
    expect(zonedToIso("2026-07-01", "18:00", TZ)).toBe("2026-07-01T18:00:00-05:00"); // CDT
    expect(new Date(zonedToIso("2026-11-20", "18:00", TZ)).toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });

  it("handles the day daylight saving ends (Nov 1, 2026)", () => {
    expect(zonedToIso("2026-11-01", "00:30", TZ)).toBe("2026-11-01T00:30:00-05:00");
    expect(zonedToIso("2026-11-01", "12:00", TZ)).toBe("2026-11-01T12:00:00-06:00");
  });

  it("shows times in the festival zone, whatever the viewer's zone", () => {
    expect(clockTime("2026-11-21T00:00:00Z", TZ)).toBe("18:00");
    expect(isoDay("2026-11-21T00:00:00Z", TZ)).toBe("2026-11-20");
  });

  it("measures minutes from the festival-local midnight, past midnight too", () => {
    expect(minutesFromDayStart("2026-11-21T00:00:00Z", "2026-11-20", TZ)).toBe(18 * 60);
    expect(minutesFromDayStart("2026-11-21T06:30:00Z", "2026-11-20", TZ)).toBe(24 * 60 + 30);
  });

  it("formats days and durations for people", () => {
    expect(formatDay("2026-11-20")).toBe("Friday, November 20");
    expect(formatDay("2026-11-20", "short")).toBe("Fri, Nov 20");
    expect(formatDuration(105)).toBe("1 h 45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(45)).toBe("45 min");
  });
});
