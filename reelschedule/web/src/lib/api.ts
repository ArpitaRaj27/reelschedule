/** Typed fetch wrapper for the ReelSchedule API with one consistent error type. */

const BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/+$/, "");

export const apiUrl = (path: string): string => `${BASE}${path}`;

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level validation messages keyed by field name (400 validation_failed). */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as FieldError[]) if (d?.field && !out[d.field]) out[d.field] = d.message;
    }
    return out;
  }
}

let tokenSource: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

/** Called once by the auth provider so requests can attach the current access token. */
export function configureAuth(source: () => string | null, unauthorized: () => void): void {
  tokenSource = source;
  onUnauthorized = unauthorized;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Attach the signed-in user's token. Public reads leave this off so they stay cacheable. */
  auth?: boolean;
  /** Use this token instead of the stored one (sign-in validation). */
  token?: string;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const token = opts.token ?? (opts.auth ? tokenSource() : null);
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Can't reach the schedule server. Check your connection and try again.");
  }

  if (!res.ok) {
    let body: { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const e = body?.error;
    if (res.status === 401 && opts.auth && !opts.token) onUnauthorized();
    throw new ApiError(
      res.status,
      e?.code ?? `http_${res.status}`,
      e?.message ?? `The server answered ${res.status}.`,
      e?.details,
      e?.requestId ?? res.headers.get("x-request-id") ?? undefined,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Build a query string, dropping empty values. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const FRIENDLY: Record<string, string> = {
  network_error: "Can't reach the schedule server. Check your connection and try again.",
  rate_limited: "Too many changes in a short time. Wait a minute, then try again.",
  provider_unavailable: "The film database (TMDB) isn't responding. Films already in ReelSchedule can still be scheduled.",
  stale_version: "Someone else changed this screening while you were editing. Load the latest version, then try again.",
  forbidden: "Your account can view the program but can't change it.",
  insufficient_scope: "Your sign-in doesn't include permission to change the schedule. Sign in again with the programmer scope.",
  unauthenticated: "Sign in as a programmer to make changes.",
  invalid_token: "Your sign-in has expired. Sign in again to continue.",
};

/** Plain-language message for an error, preferring our own wording for known codes. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message;
  return "Something unexpected went wrong. Reload the page and try again.";
}
