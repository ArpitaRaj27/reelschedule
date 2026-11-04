import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { authenticate, getPrincipal, requireAccess, requirePrincipal, ROLES, SCOPES, type TokenVerifier } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { errorHandler, HttpError } from "./errors.js";
import type { EventHub } from "./events.js";
import { log } from "./logger.js";
import { FilmListQuery, FilmSearchQuery, ImportInput, importFilm, listFilms } from "./services/films.js";
import {
  CancelInput,
  cancelScreening,
  CreateInput,
  createScreening,
  getScreening,
  ListQuery,
  listScreenings,
  previewScreening,
  RescheduleInput,
  rescheduleScreening,
  roomSchedule,
  type ActorContext,
} from "./services/screenings.js";
import type { TmdbClient } from "./tmdb.js";
import { z } from "zod";

export interface AppDeps {
  config: Config;
  db: Db;
  verifier: TokenVerifier;
  tmdb: TmdbClient;
  hub: EventHub;
  /** Requests per minute; tests raise these to avoid flakiness. */
  limits?: { writesPerMinute?: number; providerPerMinute?: number };
}

const Uuid = z.uuid();
const DateQuery = z.object({ date: z.iso.date().optional() });

/** Public, identical-for-everyone GET responses may be shared by a CDN for a few seconds. */
/**
 * Public read caching.
 * - Browsers: max-age=0, so they revalidate every time (cheap 304 via ETag) and never show an
 *   old schedule after a live update.
 * - Shared caches/CDN: s-maxage=10. CDN-Cache-Control (honoured by CDNs that support it, and
 *   ignored by browsers) adds stale-while-revalidate so the edge can answer instantly while it refreshes.
 * - Live clients add ?v=<latest change id> after each change event: a new cache key, so the first
 *   viewer's request fills the edge for every other viewer and nobody gets a pre-change copy.
 */
const PUBLIC_CACHE = "public, max-age=0, s-maxage=10";
const CDN_CACHE = "max-age=10, stale-while-revalidate=20";

export function createApp(deps: AppDeps) {
  const { config, db, verifier, tmdb, hub } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // exactly one trusted proxy (the CDN/load balancer) in front of the API

  // Request id for correlating logs and traces; echoed back to the client.
  app.use((req, res, next) => {
    const incoming = req.get("x-request-id");
    res.locals.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.set("X-Request-Id", String(res.locals.requestId));
    next();
  });

  // CORS first so even 4xx/5xx responses carry the headers the browser needs to read them.
  app.use(
    cors({
      origin(origin, done) {
        // Non-browser clients (curl, server-to-server) send no Origin; CORS does not apply to them.
        done(null, !origin || config.corsOrigins.includes(origin));
      },
      methods: ["GET", "POST", "PATCH"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id", "Last-Event-ID"],
      exposedHeaders: ["Location", "X-Request-Id"],
      maxAge: 600,
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use(authenticate(verifier));

  // Authenticated responses must never land in a shared cache.
  app.use((req, res, next) => {
    if (req.get("authorization")) res.set("Cache-Control", "private, no-store");
    next();
  });

  app.use((req, res, next) => {
    const started = performance.now();
    res.on("finish", () => {
      log.info("request", {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
        actor: getPrincipal(res)?.sub,
      });
    });
    next();
  });

  const rateLimited = (limit: number, name: string) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: (req, res) => getPrincipal(res)?.sub ?? ipKeyGenerator(req.ip ?? "unknown"),
      handler: (_req, res) => {
        res.status(429).set("Cache-Control", "no-store").json({
          error: { code: "rate_limited", message: `Too many ${name} requests; try again in a minute`, requestId: res.locals.requestId },
        });
      },
    });
  const writeLimit = rateLimited(deps.limits?.writesPerMinute ?? 30, "write");
  const providerLimit = rateLimited(deps.limits?.providerPerMinute ?? 20, "film search");

  const ctx = (res: Response): ActorContext => ({
    actorSub: requirePrincipal(res).sub,
    via: "rest",
    requestId: String(res.locals.requestId),
  });
  const publicCache = (req: Request, res: Response) => {
    if (!req.get("authorization")) res.set({ "Cache-Control": PUBLIC_CACHE, "CDN-Cache-Control": CDN_CACHE });
  };
  const programmerWrite = requireAccess(ROLES.programmer, SCOPES.write);
  const programmerRead = requireAccess(ROLES.programmer, SCOPES.read);

  // ---------- operations ----------
  app.get("/healthz", async (_req, res) => {
    let dbOk = false;
    try {
      await db.query("SELECT 1");
      dbOk = true;
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).set("Cache-Control", "no-store").json({
      ok: dbOk,
      db: dbOk ? "up" : "down",
      commit: config.release.commitSha,
      build: config.release.buildId,
      sseClients: hub.connectedClients,
    });
  });

  // ---------- public reads ----------
  app.get("/api/screenings", async (req, res) => {
    const q = ListQuery.parse(req.query);
    publicCache(req, res);
    res.json(await listScreenings(db, q, config.festivalTimezone));
  });

  app.get("/api/screenings/:id", async (req, res) => {
    const id = Uuid.safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "not_found", "Screening not found");
    publicCache(req, res);
    res.json(await getScreening(db, id.data));
  });

  app.get("/api/rooms", async (req, res) => {
    const { rows } = await db.query(
      `SELECT r.id, r.name, r.seats, json_build_object('id', v.id, 'name', v.name, 'city', v.city) AS venue
         FROM rooms r JOIN venues v ON v.id = r.venue_id ORDER BY v.name, r.name`,
    );
    publicCache(req, res);
    res.json({ items: rows });
  });

  app.get("/api/rooms/:id/schedule", async (req, res) => {
    const id = Uuid.safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "not_found", "Room not found");
    const { date } = DateQuery.parse(req.query);
    publicCache(req, res);
    res.json(await roomSchedule(db, id.data, date, config.festivalTimezone));
  });

  app.get("/api/films", async (req, res) => {
    const { q } = FilmListQuery.parse(req.query);
    publicCache(req, res);
    res.json({ items: await listFilms(db, q) });
  });

  app.get("/api/meta", async (req, res) => {
    const { rows } = await db.query<{ day: string }>(
      "SELECT DISTINCT to_char(starts_at AT TIME ZONE $1, 'YYYY-MM-DD') AS day FROM screenings ORDER BY 1",
      [config.festivalTimezone],
    );
    publicCache(req, res);
    res.json({
      festivalName: "Lakeshore Film Festival",
      timezone: config.festivalTimezone,
      defaultBufferMinutes: config.defaultBufferMinutes,
      days: rows.map((r) => r.day),
    });
  });

  app.get("/api/genres", async (req, res) => {
    const { rows } = await db.query<{ genre: string }>(
      "SELECT DISTINCT unnest(genres) AS genre FROM film_references ORDER BY 1",
    );
    publicCache(req, res);
    res.json({ items: rows.map((r) => r.genre) });
  });

  app.get("/api/events", hub.handler);

  // ---------- signed-in ----------
  app.get("/api/me", (_req, res) => {
    const p = requirePrincipal(res);
    res.json({ sub: p.sub, roles: p.roles, scopes: p.scopes, canProgram: p.roles.includes(ROLES.programmer) && p.scopes.includes(SCOPES.write) });
  });

  // ---------- programmer: third-party-backed ----------
  app.get("/api/films/search", programmerRead, providerLimit, async (req, res) => {
    const { q } = FilmSearchQuery.parse(req.query);
    const r = await tmdb.search(q);
    res.json({ items: r.data, fetchedAt: r.fetchedAt, stale: r.stale, attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB." });
  });

  app.post("/api/films/import", programmerWrite, providerLimit, async (req, res) => {
    const { tmdbId } = ImportInput.parse(req.body);
    const r = await importFilm(db, tmdb, ctx(res), tmdbId);
    res.status(r.created ? 201 : 200);
    if (r.created) res.location(`/api/films/${r.film.id}`);
    res.json({ film: r.film, stale: r.stale });
  });

  // ---------- programmer: schedule writes ----------
  app.post("/api/screenings/preview", programmerRead, async (req, res) => {
    const input = CreateInput.parse(req.body);
    res.json(await previewScreening(db, input, config.defaultBufferMinutes));
  });

  app.post("/api/screenings", programmerWrite, writeLimit, async (req, res) => {
    const input = CreateInput.parse(req.body);
    const created = await createScreening(db, ctx(res), input, config.defaultBufferMinutes);
    res.status(201).location(`/api/screenings/${created.id}`).json(created);
  });

  app.patch("/api/screenings/:id", programmerWrite, writeLimit, async (req, res) => {
    const id = Uuid.safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "not_found", "Screening not found");
    const input = RescheduleInput.parse(req.body);
    res.json(await rescheduleScreening(db, ctx(res), id.data, input));
  });

  app.post("/api/screenings/:id/cancel", programmerWrite, writeLimit, async (req, res) => {
    const id = Uuid.safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "not_found", "Screening not found");
    const input = CancelInput.parse(req.body);
    res.json(await cancelScreening(db, ctx(res), id.data, input));
  });

  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`));
  });
  app.use(errorHandler);
  return app;
}
