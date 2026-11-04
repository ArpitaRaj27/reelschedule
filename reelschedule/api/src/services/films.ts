import { z } from "zod";
import { writeAudit } from "../audit.js";
import { withTransaction, type Db } from "../db.js";
import type { TmdbClient } from "../tmdb.js";
import type { ActorContext } from "./screenings.js";

export const FilmListQuery = z.object({ q: z.string().trim().max(100).optional() });
export const FilmSearchQuery = z.object({ q: z.string().trim().min(2).max(100) });
export const ImportInput = z.object({ tmdbId: z.number().int().positive() });

export interface FilmDto {
  id: string;
  source: string;
  tmdbId: number | null;
  title: string;
  runtimeMinutes: number | null;
  genres: string[];
  releaseYear: number | null;
  posterPath: string | null;
  fetchedAt: string;
}

interface FilmRow {
  id: string;
  source: string;
  tmdb_id: number | null;
  title: string;
  runtime_minutes: number | null;
  genres: string[];
  release_year: number | null;
  poster_path: string | null;
  fetched_at: Date;
}

const toDto = (r: FilmRow): FilmDto => ({
  id: r.id,
  source: r.source,
  tmdbId: r.tmdb_id,
  title: r.title,
  runtimeMinutes: r.runtime_minutes,
  genres: r.genres,
  releaseYear: r.release_year,
  posterPath: r.poster_path,
  fetchedAt: r.fetched_at.toISOString(),
});

/** Saved film references (local data: keeps working when TMDB is down). */
export async function listFilms(db: Db, q?: string): Promise<FilmDto[]> {
  const { rows } = await db.query<FilmRow>(
    `SELECT * FROM film_references
      WHERE ($1::text IS NULL OR title ILIKE '%' || $1 || '%')
      ORDER BY lower(title) LIMIT 100`,
    [q ?? null],
  );
  return rows.map(toDto);
}

/** Fetch TMDB details and save (or refresh) the film reference. Existing screenings keep their own runtime snapshot. */
export async function importFilm(
  db: Db,
  tmdb: TmdbClient,
  ctx: ActorContext,
  tmdbId: number,
): Promise<{ film: FilmDto; created: boolean; stale: boolean }> {
  const result = await tmdb.details(tmdbId);
  const d = result.data;
  return withTransaction(db, async (client) => {
    const existing = await client.query<FilmRow>("SELECT * FROM film_references WHERE tmdb_id = $1 FOR UPDATE", [tmdbId]);
    const { rows } = await client.query<FilmRow>(
      `INSERT INTO film_references (source, tmdb_id, title, runtime_minutes, genres, release_year, poster_path, fetched_at)
       VALUES ('tmdb', $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tmdb_id) DO UPDATE
         SET title = EXCLUDED.title, runtime_minutes = EXCLUDED.runtime_minutes, genres = EXCLUDED.genres,
             release_year = EXCLUDED.release_year, poster_path = EXCLUDED.poster_path, fetched_at = EXCLUDED.fetched_at
       RETURNING *`,
      [d.tmdbId, d.title, d.runtimeMinutes, d.genres, d.releaseYear, d.posterPath, result.fetchedAt],
    );
    const film = toDto(rows[0]!);
    const before = existing.rows[0] ? toDto(existing.rows[0]) : null;
    await writeAudit(client, {
      ...ctx,
      action: before ? "film.refreshed" : "film.imported",
      entityType: "film_reference",
      entityId: film.id,
      before,
      after: film,
    });
    return { film, created: !before, stale: result.stale };
  });
}
