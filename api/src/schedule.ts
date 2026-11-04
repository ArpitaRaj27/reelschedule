import { HttpError } from "./errors.js";

/**
 * Core scheduling calculation (pure, unit-tested).
 *
 *   ends_at        = starts_at + runtime
 *   occupied_until = ends_at + turnaround buffer
 *
 * Intervals are half-open [start, occupied_until): a screening occupying a room
 * until 20:00 does not conflict with one that starts at exactly 20:00.
 *
 * Hand-predicted example (project brief): 18:00 start, 105-minute runtime,
 * 15-minute buffer → occupies the room until 20:00. A 19:50 start conflicts;
 * a 20:00 start is allowed.
 */
export interface ScreeningInterval {
  startsAt: Date;
  endsAt: Date;
  occupiedUntil: Date;
  runtimeMinutes: number;
  bufferMinutes: number;
}

const MINUTE = 60_000;

export function computeInterval(
  startsAt: Date,
  runtimeMinutes: number | null | undefined,
  bufferMinutes: number,
): ScreeningInterval {
  if (Number.isNaN(startsAt.getTime())) {
    throw new HttpError(400, "validation_failed", "startsAt is not a valid date-time");
  }
  if (runtimeMinutes === null || runtimeMinutes === undefined || !Number.isInteger(runtimeMinutes) || runtimeMinutes <= 0) {
    // Never assume zero minutes for a missing runtime.
    throw new HttpError(
      400,
      "runtime_missing",
      "This film has no runtime, so its end time cannot be calculated. Add a runtime before scheduling.",
    );
  }
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120) {
    throw new HttpError(400, "validation_failed", "bufferMinutes must be a whole number from 0 to 120");
  }
  const endsAt = new Date(startsAt.getTime() + runtimeMinutes * MINUTE);
  const occupiedUntil = new Date(endsAt.getTime() + bufferMinutes * MINUTE);
  return { startsAt, endsAt, occupiedUntil, runtimeMinutes, bufferMinutes };
}

/** Half-open overlap test: [aStart, aEnd) and [bStart, bEnd) share at least one instant. */
export function overlaps(
  a: { startsAt: Date; occupiedUntil: Date },
  b: { startsAt: Date; occupiedUntil: Date },
): boolean {
  return a.startsAt < b.occupiedUntil && b.startsAt < a.occupiedUntil;
}
