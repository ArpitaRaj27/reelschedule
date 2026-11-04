import type pg from "pg";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { withTransaction, type Db } from "../db.js";
import { badRequest, conflict, HttpError, notFound } from "../errors.js";
import { publishChange } from "../events.js";
import { computeInterval } from "../schedule.js";

/**
 * Screening rules shared by the REST API and the MCP tools, so both paths
 * enforce exactly the same validation, conflict checks, audit and live updates.
 */

export interface ActorContext {
  actorSub: string;
  via: "rest" | "mcp";
  requestId?: string;
}

// ---------- input schemas (runtime validation) ----------

const isoWithOffset = z.iso.datetime({ offset: true });

export const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  date: z.iso.date().optional(),
  roomId: z.uuid().optional(),
  genre: z.string().trim().max(50).optional(),
  status: z.enum(["scheduled", "canceled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof ListQuery>;

export const CreateInput = z.object({
  filmId: z.uuid(),
  roomId: z.uuid(),
  startsAt: isoWithOffset,
  bufferMinutes: z.number().int().min(0).max(120).optional(),
});
export type CreateInput = z.infer<typeof CreateInput>;

export const RescheduleInput = z
  .object({
    version: z.number().int().positive(),
    startsAt: isoWithOffset.optional(),
    roomId: z.uuid().optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
  })
  .refine((v) => v.startsAt !== undefined || v.roomId !== undefined || v.bufferMinutes !== undefined, {
    message: "Provide at least one of startsAt, roomId or bufferMinutes",
  });
export type RescheduleInput = z.infer<typeof RescheduleInput>;

export const CancelInput = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(3).max(200),
});
export type CancelInput = z.infer<typeof CancelInput>;

// ---------- output shape ----------

export interface ScreeningDto {
  id: string;
  status: "scheduled" | "canceled";
  startsAt: string;
  endsAt: string;
  occupiedUntil: string;
  runtimeMinutes: number;
  bufferMinutes: number;
  version: number;
  updatedAt: string;
  film: { id: string; title: string; genres: string[]; releaseYear: number | null; posterPath: string | null; source: string };
  room: { id: string; name: string; seats: number; venue: { id: string; name: string } };
}

interface ScreeningRow {
  id: string;
  status: "scheduled" | "canceled";
  starts_at: Date;
  ends_at: Date;
  occupied_until: Date;
  runtime_minutes: number;
  buffer_minutes: number;
  version: number;
  updated_at: Date;
  film_id: string;
  title: string;
  genres: string[];
  release_year: number | null;
  poster_path: string | null;
  source: string;
  room_id: string;
  room_name: string;
  seats: number;
  venue_id: string;
  venue_name: string;
}

const SELECT = `
  SELECT s.id, s.status, s.starts_at, s.ends_at, s.occupied_until, s.runtime_minutes, s.buffer_minutes,
         s.version, s.updated_at, s.film_id, f.title, f.genres, f.release_year, f.poster_path, f.source,
         s.room_id, r.name AS room_name, r.seats, v.id AS venue_id, v.name AS venue_name
    FROM screenings s
    JOIN film_references f ON f.id = s.film_id
    JOIN rooms r ON r.id = s.room_id
    JOIN venues v ON v.id = r.venue_id`;

export function toDto(r: ScreeningRow): ScreeningDto {
  return {
    id: r.id,
    status: r.status,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    occupiedUntil: r.occupied_until.toISOString(),
    runtimeMinutes: r.runtime_minutes,
    bufferMinutes: r.buffer_minutes,
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
    film: { id: r.film_id, title: r.title, genres: r.genres, releaseYear: r.release_year, posterPath: r.poster_path, source: r.source },
    room: { id: r.room_id, name: r.room_name, seats: r.seats, venue: { id: r.venue_id, name: r.venue_name } },
  };
}

async function loadOne(client: pg.PoolClient | Db, id: string): Promise<ScreeningDto | undefined> {
  const { rows } = await client.query<ScreeningRow>(`${SELECT} WHERE s.id = $1`, [id]);
  return rows[0] ? toDto(rows[0]) : undefined;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ---------- reads ----------

export async function listScreenings(
  db: Db,
  q: ListQuery,
  timezone: string,
): Promise<{ items: ScreeningDto[]; count: number; page: number; pageSize: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (q.q) add("f.title ILIKE '%' || ? || '%'", escapeLike(q.q));
  if (q.date) {
    // Festival-local calendar day → [00:00, next 00:00) in the festival time zone (index-friendly).
    params.push(q.date, timezone);
    const d = params.length - 1;
    const tz = params.length;
    where.push(`s.starts_at >= ($${d}::date::timestamp AT TIME ZONE $${tz}) AND s.starts_at < (($${d}::date + 1)::timestamp AT TIME ZONE $${tz})`);
  }
  if (q.roomId) add("s.room_id = ?", q.roomId);
  if (q.genre) add("EXISTS (SELECT 1 FROM unnest(f.genres) g WHERE lower(g) = lower(?))", q.genre);
  if (q.status) add("s.status = ?::screening_status", q.status);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRes = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM screenings s JOIN film_references f ON f.id = s.film_id ${whereSql}`,
    params,
  );
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const { rows } = await db.query<ScreeningRow>(
    `${SELECT} ${whereSql} ORDER BY s.starts_at, r.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.map(toDto), count: countRes.rows[0]?.count ?? 0, page: q.page, pageSize: q.pageSize };
}

export async function getScreening(db: Db, id: string): Promise<ScreeningDto> {
  const s = await loadOne(db, id);
  if (!s) throw notFound("Screening");
  return s;
}

export async function roomSchedule(
  db: Db,
  roomId: string,
  date: string | undefined,
  timezone: string,
): Promise<{ room: { id: string; name: string; seats: number; venue: string }; screenings: ScreeningDto[] }> {
  const room = await db.query<{ id: string; name: string; seats: number; venue: string }>(
    "SELECT r.id, r.name, r.seats, v.name AS venue FROM rooms r JOIN venues v ON v.id = r.venue_id WHERE r.id = $1",
    [roomId],
  );
  if (!room.rows[0]) throw notFound("Room");
  const list = await listScreenings(db, { roomId, date, page: 1, pageSize: 100 } as ListQuery, timezone);
  return { room: room.rows[0], screenings: list.items };
}

export interface ConflictSummary {
  id: string;
  title: string;
  startsAt: string;
  occupiedUntil: string;
}

async function findConflicts(
  client: pg.PoolClient | Db,
  roomId: string,
  start: Date,
  occupiedUntil: Date,
  excludeId: string | null,
): Promise<ConflictSummary[]> {
  const { rows } = await client.query<{ id: string; title: string; starts_at: Date; occupied_until: Date }>(
    `SELECT s.id, f.title, s.starts_at, s.occupied_until
       FROM screenings s JOIN film_references f ON f.id = s.film_id
      WHERE s.room_id = $1 AND s.status = 'scheduled'
        AND tstzrange(s.starts_at, s.occupied_until, '[)') && tstzrange($2, $3, '[)')
        AND ($4::uuid IS NULL OR s.id <> $4)
      ORDER BY s.starts_at`,
    [roomId, start, occupiedUntil, excludeId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, startsAt: r.starts_at.toISOString(), occupiedUntil: r.occupied_until.toISOString() }));
}

async function loadFilm(client: pg.PoolClient | Db, filmId: string) {
  const { rows } = await client.query<{ id: string; title: string; runtime_minutes: number | null }>(
    "SELECT id, title, runtime_minutes FROM film_references WHERE id = $1",
    [filmId],
  );
  if (!rows[0]) throw badRequest("Unknown film", [{ field: "filmId", message: "No film reference with this id" }]);
  return rows[0];
}

async function assertRoom(client: pg.PoolClient | Db, roomId: string) {
  const { rows } = await client.query("SELECT 1 FROM rooms WHERE id = $1", [roomId]);
  if (!rows[0]) throw badRequest("Unknown room", [{ field: "roomId", message: "No room with this id" }]);
}

/** Calculate the interval and current conflicts without writing anything (used by the UI and the MCP App). */
export async function previewScreening(db: Db, input: CreateInput, defaultBuffer: number) {
  const film = await loadFilm(db, input.filmId);
  await assertRoom(db, input.roomId);
  const iv = computeInterval(new Date(input.startsAt), film.runtime_minutes, input.bufferMinutes ?? defaultBuffer);
  const conflicts = await findConflicts(db, input.roomId, iv.startsAt, iv.occupiedUntil, null);
  return {
    film: { id: film.id, title: film.title },
    roomId: input.roomId,
    startsAt: iv.startsAt.toISOString(),
    endsAt: iv.endsAt.toISOString(),
    occupiedUntil: iv.occupiedUntil.toISOString(),
    runtimeMinutes: iv.runtimeMinutes,
    bufferMinutes: iv.bufferMinutes,
    conflicts,
    ok: conflicts.length === 0,
  };
}

/** Insert/update inside a savepoint so an exclusion violation can be reported with the conflicting screenings. */
async function guardOverlap<T>(
  client: pg.PoolClient,
  write: () => Promise<T>,
  conflictArgs: [string, Date, Date, string | null],
): Promise<T> {
  await client.query("SAVEPOINT write_screening");
  try {
    const result = await write();
    await client.query("RELEASE SAVEPOINT write_screening");
    return result;
  } catch (err) {
    if ((err as { code?: string }).code !== "23P01") throw err;
    await client.query("ROLLBACK TO SAVEPOINT write_screening");
    const conflicts = await findConflicts(client, ...conflictArgs);
    throw conflict("schedule_conflict", "The room is already occupied for part of that interval (including the turnaround buffer)", { conflicts });
  }
}

// ---------- writes ----------

export async function createScreening(
  db: Db,
  ctx: ActorContext,
  input: CreateInput,
  defaultBuffer: number,
): Promise<ScreeningDto> {
  return withTransaction(db, async (client) => {
    const film = await loadFilm(client, input.filmId);
    await assertRoom(client, input.roomId);
    const iv = computeInterval(new Date(input.startsAt), film.runtime_minutes, input.bufferMinutes ?? defaultBuffer);

    const id = await guardOverlap(
      client,
      async () => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO screenings (film_id, room_id, starts_at, runtime_minutes, buffer_minutes, ends_at, occupied_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [input.filmId, input.roomId, iv.startsAt, iv.runtimeMinutes, iv.bufferMinutes, iv.endsAt, iv.occupiedUntil],
        );
        return rows[0]!.id;
      },
      [input.roomId, iv.startsAt, iv.occupiedUntil, null],
    );

    const after = (await loadOne(client, id))!;
    await writeAudit(client, { ...ctx, action: "screening.created", entityType: "screening", entityId: id, before: null, after });
    await publishChange(client, { type: "screening.created", screeningId: id, roomId: after.room.id, payload: after });
    return after;
  });
}

async function lockForChange(client: pg.PoolClient, id: string, version: number): Promise<ScreeningDto> {
  const { rows } = await client.query<{ id: string; version: number }>(
    "SELECT id, version FROM screenings WHERE id = $1 FOR UPDATE",
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound("Screening");
  if (row.version !== version) {
    throw conflict("stale_version", "This screening changed since you loaded it; reload and try again", {
      currentVersion: row.version,
    });
  }
  return (await loadOne(client, id))!;
}

export async function rescheduleScreening(
  db: Db,
  ctx: ActorContext,
  id: string,
  input: RescheduleInput,
): Promise<ScreeningDto> {
  return withTransaction(db, async (client) => {
    const before = await lockForChange(client, id, input.version);
    if (before.status !== "scheduled") {
      throw conflict("invalid_state", "A canceled screening cannot be rescheduled");
    }
    const roomId = input.roomId ?? before.room.id;
    if (input.roomId) await assertRoom(client, roomId);
    // Reuse the runtime snapshot saved at scheduling time; never re-read provider metadata here.
    const iv = computeInterval(
      new Date(input.startsAt ?? before.startsAt),
      before.runtimeMinutes,
      input.bufferMinutes ?? before.bufferMinutes,
    );
    await guardOverlap(
      client,
      () =>
        client.query(
          `UPDATE screenings
              SET room_id = $2, starts_at = $3, buffer_minutes = $4, ends_at = $5, occupied_until = $6,
                  version = version + 1, updated_at = now()
            WHERE id = $1 AND version = $7`,
          [id, roomId, iv.startsAt, iv.bufferMinutes, iv.endsAt, iv.occupiedUntil, input.version],
        ),
      [roomId, iv.startsAt, iv.occupiedUntil, id],
    );
    const after = (await loadOne(client, id))!;
    await writeAudit(client, { ...ctx, action: "screening.rescheduled", entityType: "screening", entityId: id, before, after });
    await publishChange(client, {
      type: "screening.rescheduled",
      screeningId: id,
      roomId: after.room.id,
      payload: { ...after, previousRoomId: before.room.id },
    });
    return after;
  });
}

export async function cancelScreening(
  db: Db,
  ctx: ActorContext,
  id: string,
  input: CancelInput,
): Promise<ScreeningDto> {
  return withTransaction(db, async (client) => {
    const before = await lockForChange(client, id, input.version);
    if (before.status === "canceled") throw conflict("invalid_state", "This screening is already canceled");
    await client.query(
      "UPDATE screenings SET status = 'canceled', version = version + 1, updated_at = now() WHERE id = $1",
      [id],
    );
    const after = (await loadOne(client, id))!;
    await writeAudit(client, {
      ...ctx,
      action: "screening.canceled",
      entityType: "screening",
      entityId: id,
      before,
      after: { ...after, reason: input.reason },
    });
    await publishChange(client, {
      type: "screening.canceled",
      screeningId: id,
      roomId: after.room.id,
      payload: { ...after, reason: input.reason },
    });
    return after;
  });
}

export { HttpError };
