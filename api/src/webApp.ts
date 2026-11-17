import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Response } from "express";
import { HttpError } from "./errors.js";

/**
 * Serves the built React app from the same origin as the API, so one hostname (behind the CDN)
 * carries the HTML, the hashed assets and /api. Cache policy per content class:
 *
 *   /assets/*  hashed filenames: the content never changes under a name, so everyone may keep it a year.
 *   HTML shell browsers revalidate every time (ETag → 304); the CDN may hold it 30 s. After a deploy,
 *              the new shell (pointing at new asset names) is everywhere within 30 s, or at once after a purge.
 *   other files (favicon) one hour.
 *   missing /assets/* → 404, never the HTML shell (a stale shell must not get HTML back for a script).
 */

export const ASSET_CACHE = "public, max-age=31536000, immutable";
export const HTML_CACHE = "public, max-age=0, must-revalidate";
export const HTML_CDN_CACHE = "max-age=30";

export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const here = path.dirname(fileURLToPath(import.meta.url));

/** api/src (dev) or api/dist/src (built) → web/dist. */
export function defaultWebDist(): string | null {
  const candidates = [path.resolve(here, "..", "..", "web", "dist"), path.resolve(here, "..", "..", "..", "web", "dist")];
  return candidates.find((d) => existsSync(path.join(d, "index.html"))) ?? null;
}

function htmlHeaders(res: Response): void {
  res.set({ "Cache-Control": HTML_CACHE, "CDN-Cache-Control": HTML_CDN_CACHE, "Content-Security-Policy": HTML_CSP });
}

export function mountWebApp(app: Express, distDir: string): void {
  app.use(
    "/assets",
    express.static(path.join(distDir, "assets"), { immutable: true, maxAge: "365d", index: false }),
    // A missing hashed asset is a 404 in the API's error shape, never the HTML shell.
    (req, _res, next) => next(new HttpError(404, "not_found", `No asset ${req.path}`)),
  );

  app.use(
    express.static(distDir, {
      index: false, // the shell is served below with its own headers
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) htmlHeaders(res);
        else res.setHeader("Cache-Control", "public, max-age=3600");
      },
    }),
  );

  // Single-page app: any other GET/HEAD outside /api, /healthz and /.well-known gets the shell.
  const shell = path.join(distDir, "index.html");
  app.get(/^\/(?!api\/|api$|healthz$|\.well-known\/).*/, (req, res, next) => {
    if (!req.accepts("html")) return next();
    htmlHeaders(res);
    res.sendFile(shell, (err) => (err ? next(err) : undefined));
  });
}
