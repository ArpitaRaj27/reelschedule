/**
 * Festival-local time helpers. Every time on screen is shown in the festival's time zone
 * (from /api/meta), never the viewer's, so a programmer abroad sees the same 18:00 as the box office.
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallTime(date: Date, tz: string): WallTime {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at this instant (America/Chicago in November: -360). */
export function zoneOffsetMinutes(date: Date, tz: string): number {
  const w = wallTime(date, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

function formatOffset(mins: number): string {
  const sign = mins < 0 ? "-" : "+";
  const a = Math.abs(mins);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** "2026-11-20" + "18:00" in America/Chicago → "2026-11-20T18:00:00-06:00". */
export function zonedToIso(day: string, time: string, tz: string): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  let offset = zoneOffsetMinutes(new Date(asUtc), tz);
  const second = zoneOffsetMinutes(new Date(asUtc - offset * 60000), tz);
  if (second !== offset) offset = second; // crossed a daylight-saving change
  return `${day}T${pad(hh)}:${pad(mm)}:00${formatOffset(offset)}`;
}

/** Festival-local calendar day of an instant, as YYYY-MM-DD. */
export function isoDay(iso: string, tz: string): string {
  const w = wallTime(new Date(iso), tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Festival-local clock time, 24-hour "HH:MM". */
export function clockTime(iso: string, tz: string): string {
  const w = wallTime(new Date(iso), tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

const dayFormats = {
  long: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }),
  short: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }),
};

/** "2026-11-20" → "Friday, November 20" (long) or "Fri, Nov 20" (short). */
export function formatDay(day: string, style: "long" | "short" = "long"): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return dayFormats[style].format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Minutes from the festival-local midnight that starts `day` (can exceed 1440 after midnight). */
export function minutesFromDayStart(iso: string, day: string, tz: string): number {
  const start = new Date(zonedToIso(day, "00:00", tz)).getTime();
  return (new Date(iso).getTime() - start) / 60000;
}

export function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
