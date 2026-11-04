/**
 * Small structured JSON logger with redaction.
 * Credentials must never reach logs or traces, including keys embedded in URLs.
 */
const SECRET_KEYS = /^(authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|token|password|secret)$/i;

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_KEYS.test(key)) u.searchParams.set(key, "[REDACTED]");
    }
    if (u.username || u.password) {
      u.username = "[REDACTED]";
      u.password = "";
    }
    return u.toString();
  } catch {
    return url.replace(/(api[_-]?key|access[_-]?token|token)=[^&\s]+/gi, "$1=[REDACTED]");
  }
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") {
    if (/^Bearer\s+/i.test(value)) return "Bearer [REDACTED]";
    if (/^https?:\/\//i.test(value)) return redactUrl(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";
type Sink = (line: string) => void;

let sink: Sink = (line) => {
  if (process.env.NODE_ENV !== "test") process.stdout.write(line + "\n");
};

/** Tests can capture log lines to prove that secrets are redacted. */
export function setLogSink(next: Sink): void {
  sink = next;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields) as object) }));
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};
