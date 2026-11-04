import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import { log, redactUrl } from "./logger.js";

/**
 * TMDB integration (film search + runtime metadata), server-side only.
 *
 * Policy (F10):
 *   - Credential: TMDB read-access token from the secret store, sent as a Bearer header
 *     (never in the URL), never logged.
 *   - Timeout: each attempt is aborted after TMDB_TIMEOUT_MS (default 3 s).
 *   - Bounded retry: up to TMDB_MAX_RETRIES (default 2) extra attempts with exponential
 *     backoff + jitter, only for network errors, timeouts, 429 and 5xx. 4xx is not retried.
 *   - Provider-aware cache in PostgreSQL: search results 10 min, film details 24 h.
 *   - Runtime validation: responses are parsed with zod; malformed data counts as a failure.
 *   - Outage: serve the last cached copy labelled stale with its fetchedAt timestamp;
 *     with no cached copy answer 503 provider_unavailable. Existing screenings are never
 *     affected because they store their own runtime snapshot.
 */

export const SEARCH_TTL_MS = 10 * 60_000;
export const DETAILS_TTL_MS = 24 * 60 * 60_000;

const SearchResponse = z.object({
  results: z.array(
    z.object({
      id: z.number().int().positive(),
      title: z.string().min(1),
      release_date: z.string().optional().nullable(),
      poster_path: z.string().nullable().optional(),
    }),
  ),
});

const MovieResponse = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  runtime: z.number().int().nonnegative().nullable().optional(),
  genres: z.array(z.object({ id: z.number(), name: z.string() })).default([]),
  release_date: z.string().optional().nullable(),
  poster_path: z.string().nullable().optional(),
});

export interface FilmSearchResult {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  posterPath: string | null;
}

export interface FilmDetails extends FilmSearchResult {
  runtimeMinutes: number | null;
  genres: string[];
}

export interface ProviderResult<T> {
  data: T;
  fetchedAt: string;
  stale: boolean;
}

const yearOf = (d: string | null | undefined): number | null => {
  const y = d ? Number.parseInt(d.slice(0, 4), 10) : Number.NaN;
  return Number.isFinite(y) ? y : null;
};

class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TmdbOptions {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  maxRetries: number;
  db: Db;
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class TmdbClient {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: TmdbOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async search(query: string): Promise<ProviderResult<FilmSearchResult[]>> {
    const q = query.trim().toLowerCase();
    return this.cached(`tmdb:search:${q}`, SEARCH_TTL_MS, async () => {
      const json = await this.request("/search/movie", { query: q, include_adult: "false" });
      const parsed = SearchResponse.safeParse(json);
      if (!parsed.success) throw new ProviderError("TMDB search response failed validation", false);
      return parsed.data.results.slice(0, 20).map((r) => ({
        tmdbId: r.id,
        title: r.title,
        releaseYear: yearOf(r.release_date),
        posterPath: r.poster_path ?? null,
      }));
    });
  }

  async details(tmdbId: number): Promise<ProviderResult<FilmDetails>> {
    return this.cached(`tmdb:movie:${tmdbId}`, DETAILS_TTL_MS, async () => {
      const json = await this.request(`/movie/${tmdbId}`, {});
      const parsed = MovieResponse.safeParse(json);
      if (!parsed.success) throw new ProviderError("TMDB movie response failed validation", false);
      const m = parsed.data;
      return {
        tmdbId: m.id,
        title: m.title,
        // TMDB reports 0 for unknown runtimes; keep that explicit as null.
        runtimeMinutes: m.runtime && m.runtime > 0 ? m.runtime : null,
        genres: m.genres.map((g) => g.name),
        releaseYear: yearOf(m.release_date),
        posterPath: m.poster_path ?? null,
      };
    });
  }

  /** Fresh cache → return it. Otherwise call the provider; on failure fall back to stale cache or 503. */
  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<ProviderResult<T>> {
    const { rows } = await this.opts.db.query<{ value: T; fetched_at: Date; expires_at: Date }>(
      "SELECT value, fetched_at, expires_at FROM provider_cache WHERE cache_key = $1",
      [key],
    );
    const hit = rows[0];
    if (hit && hit.expires_at.getTime() > this.now()) {
      return { data: hit.value, fetchedAt: hit.fetched_at.toISOString(), stale: false };
    }
    try {
      const data = await load();
      const fetchedAt = new Date(this.now());
      await this.opts.db.query(
        `INSERT INTO provider_cache (cache_key, provider, value, fetched_at, expires_at)
         VALUES ($1, 'tmdb', $2, $3, $4)
         ON CONFLICT (cache_key) DO UPDATE SET value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
        [key, JSON.stringify(data), fetchedAt, new Date(fetchedAt.getTime() + ttlMs)],
      );
      return { data, fetchedAt: fetchedAt.toISOString(), stale: false };
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) {
        throw new HttpError(404, "not_found", "TMDB has no film with that id");
      }
      if (hit) {
        log.warn("tmdb_serving_stale", { key, fetchedAt: hit.fetched_at.toISOString(), reason: (err as Error).message });
        return { data: hit.value, fetchedAt: hit.fetched_at.toISOString(), stale: true };
      }
      log.warn("tmdb_unavailable", { key, reason: (err as Error).message });
      throw new HttpError(
        503,
        "provider_unavailable",
        "Film search is temporarily unavailable. Existing screenings are unaffected; try the search again later.",
      );
    }
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    if (!this.opts.token) throw new ProviderError("TMDB token is not configured", false);
    const url = new URL(this.opts.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let lastErr: ProviderError = new ProviderError("TMDB request failed", true);
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = 200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
        await this.sleep(backoff);
      }
      try {
        const res = await this.fetchImpl(url.toString(), {
          headers: { Authorization: `Bearer ${this.opts.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (res.ok) return await res.json();
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = new ProviderError(`TMDB answered ${res.status}`, retryable, res.status);
        if (!retryable) break;
      } catch (err) {
        const name = (err as Error)?.name;
        lastErr = new ProviderError(
          name === "TimeoutError" || name === "AbortError" ? "TMDB timed out" : "TMDB network error",
          true,
        );
      }
      log.warn("tmdb_attempt_failed", { url: redactUrl(url.toString()), attempt, reason: lastErr.message });
    }
    throw lastErr;
  }
}
