import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { log } from "./logger.js";

/** One error shape for the whole API: { error: { code, message, details?, requestId } } */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "validation_failed", message, details);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details);

/** Turn zod issues into a list of field errors the UI can place next to each input. */
export function fieldErrors(err: ZodError): { field: string; message: string }[] {
  return err.issues.map((i) => ({ field: i.path.join(".") || "(body)", message: i.message }));
}

interface PgLikeError {
  code?: string;
  constraint?: string;
  type?: string;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const requestId = String(res.locals.requestId ?? "");
  const send = (status: number, code: string, message: string, details?: unknown) => {
    res.status(status).set("Cache-Control", "no-store").json({
      error: { code, message, ...(details === undefined ? {} : { details }), requestId },
    });
  };

  if (err instanceof HttpError) {
    send(err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    send(400, "validation_failed", "Request is invalid", fieldErrors(err));
    return;
  }
  const pgErr = err as PgLikeError;
  if (pgErr.code === "23P01") {
    // exclusion_violation from screenings_no_overlap: the database caught an overlap.
    send(409, "schedule_conflict", "The room is already occupied for part of that interval");
    return;
  }
  if (pgErr.code === "40001" || pgErr.code === "40P01") {
    send(409, "concurrent_update", "Another change happened at the same time; reload and retry");
    return;
  }
  if (pgErr.type === "entity.parse.failed") {
    send(400, "invalid_json", "Request body is not valid JSON");
    return;
  }
  if (pgErr.type === "entity.too.large") {
    send(413, "too_large", "Request body is too large");
    return;
  }
  log.error("unhandled_error", { requestId, path: req.path, err: String((err as Error)?.stack ?? err) });
  send(500, "internal_error", "Unexpected server error");
};
