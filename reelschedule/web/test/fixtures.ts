import type { Film, Meta, Room, Screening } from "../src/lib/types";

export const META: Meta = { festivalName: "Lakeshore Film Festival", timezone: "America/Chicago", defaultBufferMinutes: 15, days: ["2026-11-20", "2026-11-21"] };

export const ROOMS: Room[] = [
  { id: "room-main", name: "Main Hall", seats: 320, venue: { id: "v1", name: "Harborview Cinema House", city: "Chicago" } },
  { id: "room-loft", name: "The Loft", seats: 60, venue: { id: "v2", name: "Riverside Arts Center", city: "Chicago" } },
];

export const FILMS: Film[] = [
  { id: "film-harbor", source: "synthetic", tmdbId: null, title: "The Quiet Harbor", runtimeMinutes: 105, genres: ["Drama"], releaseYear: 2024, posterPath: null, fetchedAt: "2026-11-01T00:00:00Z" },
  { id: "film-orchard", source: "synthetic", tmdbId: null, title: "Neon Orchard", runtimeMinutes: 92, genres: ["Science Fiction"], releaseYear: 2025, posterPath: null, fetchedAt: "2026-11-01T00:00:00Z" },
];

export function screening(over: Partial<Screening> = {}): Screening {
  return {
    id: "s1",
    status: "scheduled",
    startsAt: "2026-11-21T00:00:00.000Z", // 18:00 Chicago on Nov 20
    endsAt: "2026-11-21T01:45:00.000Z",
    occupiedUntil: "2026-11-21T02:00:00.000Z",
    runtimeMinutes: 105,
    bufferMinutes: 15,
    version: 1,
    updatedAt: "2026-11-01T00:00:00Z",
    film: { id: "film-harbor", title: "The Quiet Harbor", genres: ["Drama"], releaseYear: 2024, posterPath: null, source: "synthetic" },
    room: { id: "room-main", name: "Main Hall", seats: 320, venue: { id: "v1", name: "Harborview Cinema House" } },
    ...over,
  };
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Route fetch calls by "METHOD /path" to handlers; anything unrouted fails the test loudly. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; init: RequestInit }[] = [];
  const fn = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = init.method ?? "GET";
    calls.push({ method, path: url.pathname + url.search, init });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return json({ error: { code: "not_found", message: `unmocked ${method} ${url.pathname}`, requestId: "test" } }, 404);
    return handler(url, init);
  };
  return { fn, calls };
}
