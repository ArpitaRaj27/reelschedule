import { loadConfig } from "../src/config.js";
import { createPool, withTransaction } from "../src/db.js";
import { computeInterval } from "../src/schedule.js";

/**
 * Synthetic seed data for the fictional "Lakeshore Film Festival".
 * Every venue, room, film reference and screening here is invented.
 * Idempotent: safe to run more than once.
 */
export const IDS = {
  venues: {
    harbor: "11111111-1111-4111-8111-111111111111",
    arts: "22222222-2222-4222-8222-222222222222",
  },
  rooms: {
    main: "aaaaaaaa-0001-4000-8000-000000000001",
    studio: "aaaaaaaa-0002-4000-8000-000000000002",
    loft: "aaaaaaaa-0003-4000-8000-000000000003",
    gallery: "aaaaaaaa-0004-4000-8000-000000000004",
  },
  films: {
    harbor: "ffffffff-0001-4000-8000-000000000001",
    orchard: "ffffffff-0002-4000-8000-000000000002",
    lanterns: "ffffffff-0003-4000-8000-000000000003",
    hours: "ffffffff-0004-4000-8000-000000000004",
    atlas: "ffffffff-0005-4000-8000-000000000005",
    shorts: "ffffffff-0006-4000-8000-000000000006",
  },
};

const VENUES = [
  { id: IDS.venues.harbor, name: "Harborview Cinema House", city: "Chicago" },
  { id: IDS.venues.arts, name: "Riverside Arts Center", city: "Chicago" },
];
const ROOMS = [
  { id: IDS.rooms.main, venue: IDS.venues.harbor, name: "Main Hall", seats: 320 },
  { id: IDS.rooms.studio, venue: IDS.venues.harbor, name: "Studio B", seats: 90 },
  { id: IDS.rooms.loft, venue: IDS.venues.arts, name: "The Loft", seats: 60 },
  { id: IDS.rooms.gallery, venue: IDS.venues.arts, name: "Gallery Room", seats: 45 },
];
const FILMS = [
  { id: IDS.films.harbor, title: "The Quiet Harbor", runtime: 105, genres: ["Drama"], year: 2025 },
  { id: IDS.films.orchard, title: "Neon Orchard", runtime: 92, genres: ["Science Fiction"], year: 2026 },
  { id: IDS.films.lanterns, title: "Paper Lanterns", runtime: 118, genres: ["Drama", "Romance"], year: 2024 },
  { id: IDS.films.hours, title: "Small Hours", runtime: 84, genres: ["Comedy"], year: 2026 },
  { id: IDS.films.atlas, title: "Atlas of Rain", runtime: 131, genres: ["Documentary"], year: 2025 },
  // Deliberately missing runtime: scheduling it must fail with runtime_missing.
  { id: IDS.films.shorts, title: "Untitled Shorts Program", runtime: null, genres: ["Animation"], year: 2026 },
];
// Festival-local times (America/Chicago, UTC-06:00 in November).
const SCREENINGS = [
  { film: IDS.films.harbor, room: IDS.rooms.main, start: "2026-11-20T18:00:00-06:00" },
  { film: IDS.films.orchard, room: IDS.rooms.main, start: "2026-11-20T20:00:00-06:00" },
  { film: IDS.films.hours, room: IDS.rooms.studio, start: "2026-11-20T19:00:00-06:00" },
  { film: IDS.films.lanterns, room: IDS.rooms.loft, start: "2026-11-21T14:00:00-06:00" },
  { film: IDS.films.atlas, room: IDS.rooms.main, start: "2026-11-21T16:30:00-06:00" },
  { film: IDS.films.orchard, room: IDS.rooms.gallery, start: "2026-11-21T19:15:00-06:00" },
  { film: IDS.films.harbor, room: IDS.rooms.studio, start: "2026-11-22T13:00:00-06:00" },
  { film: IDS.films.hours, room: IDS.rooms.main, start: "2026-11-22T18:30:00-06:00" },
];

export async function seed(databaseUrl: string, bufferMinutes = 15): Promise<void> {
  const db = createPool(databaseUrl);
  try {
    await withTransaction(db, async (c) => {
      for (const v of VENUES) {
        await c.query("INSERT INTO venues (id, name, city) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [v.id, v.name, v.city]);
      }
      for (const r of ROOMS) {
        await c.query("INSERT INTO rooms (id, venue_id, name, seats) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", [r.id, r.venue, r.name, r.seats]);
      }
      for (const f of FILMS) {
        await c.query(
          `INSERT INTO film_references (id, source, title, runtime_minutes, genres, release_year)
           VALUES ($1, 'synthetic', $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [f.id, f.title, f.runtime, f.genres, f.year],
        );
      }
      const { rows } = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM screenings");
      if ((rows[0]?.n ?? 0) > 0) return;
      for (const s of SCREENINGS) {
        const film = FILMS.find((f) => f.id === s.film)!;
        const iv = computeInterval(new Date(s.start), film.runtime, bufferMinutes);
        await c.query(
          `INSERT INTO screenings (film_id, room_id, starts_at, runtime_minutes, buffer_minutes, ends_at, occupied_until)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [s.film, s.room, iv.startsAt, iv.runtimeMinutes, iv.bufferMinutes, iv.endsAt, iv.occupiedUntil],
        );
      }
    });
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  await seed(config.databaseUrl, config.defaultBufferMinutes);
  console.log("Seeded synthetic festival data");
}
