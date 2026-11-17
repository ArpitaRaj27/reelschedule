import type { Db } from "../db.js";

/**
 * GET /api/status — the festival's "now showing / next up" feed. The program page polls it,
 * so it is the route with real database work that the app cache sits in front of.
 */

export interface StatusItem {
  id: string;
  title: string;
  room: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  occupiedUntil: string;
}

export interface FestivalStatus {
  festival: string;
  timezone: string;
  generatedAt: string;
  nowShowing: StatusItem[];
  nextUp: StatusItem[];
  totals: { scheduled: number; canceled: number; rooms: number; roomsInUseNow: number };
}

interface Row {
  id: string;
  title: string;
  room: string;
  venue: string;
  starts_at: Date;
  ends_at: Date;
  occupied_until: Date;
}

const ITEM_SQL = `
  SELECT s.id, f.title, r.name AS room, v.name AS venue, s.starts_at, s.ends_at, s.occupied_until
    FROM screenings s
    JOIN film_references f ON f.id = s.film_id
    JOIN rooms r ON r.id = s.room_id
    JOIN venues v ON v.id = r.venue_id
   WHERE s.status = 'scheduled'`;

const toItem = (r: Row): StatusItem => ({
  id: r.id,
  title: r.title,
  room: r.room,
  venue: r.venue,
  startsAt: r.starts_at.toISOString(),
  endsAt: r.ends_at.toISOString(),
  occupiedUntil: r.occupied_until.toISOString(),
});

export async function festivalStatus(db: Db, timezone: string, now: Date = new Date()): Promise<FestivalStatus> {
  const [showing, next, totals] = await Promise.all([
    db.query<Row>(`${ITEM_SQL} AND s.starts_at <= $1 AND s.ends_at > $1 ORDER BY s.starts_at`, [now]),
    db.query<Row>(`${ITEM_SQL} AND s.starts_at > $1 ORDER BY s.starts_at LIMIT 5`, [now]),
    db.query<{ scheduled: number; canceled: number; rooms: number; in_use: number }>(
      `SELECT count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
              count(*) FILTER (WHERE status = 'canceled')::int AS canceled,
              (SELECT count(*)::int FROM rooms) AS rooms,
              count(DISTINCT room_id) FILTER (WHERE status = 'scheduled' AND starts_at <= $1 AND occupied_until > $1)::int AS in_use
         FROM screenings`,
      [now],
    ),
  ]);
  const t = totals.rows[0]!;
  return {
    festival: "Lakeshore Film Festival",
    timezone,
    generatedAt: now.toISOString(),
    nowShowing: showing.rows.map(toItem),
    nextUp: next.rows.map(toItem),
    totals: { scheduled: t.scheduled, canceled: t.canceled, rooms: t.rooms, roomsInUseNow: t.in_use },
  };
}
