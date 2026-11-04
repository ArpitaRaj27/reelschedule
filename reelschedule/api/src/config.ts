import { z } from "zod";

/**
 * All configuration comes from environment variables so staging and production
 * differ only in config and secrets, never in code.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1).default("postgres://postgres@localhost:5432/reelschedule"),
  // Exact-origin CORS allowlist, comma separated. Never "*".
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  FESTIVAL_TIMEZONE: z.string().default("America/Chicago"),
  DEFAULT_BUFFER_MINUTES: z.coerce.number().int().min(0).max(120).default(15),

  // OIDC / OAuth access-token validation (e.g. Microsoft Entra ID).
  AUTH_ISSUER: z.string().optional(),
  AUTH_AUDIENCE: z.string().optional(),
  AUTH_JWKS_URI: z.string().url().optional(),
  // Local development only: a JWKS file produced by `npm run dev-token`. Refused in production.
  DEV_AUTH_JWKS_FILE: z.string().optional(),

  // TMDB. The read-access token is a secret: set it from the secret store, never commit it.
  TMDB_BASE_URL: z.string().url().default("https://api.themoviedb.org/3"),
  TMDB_READ_TOKEN: z.string().optional(),
  TMDB_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  TMDB_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  // Release identity reported by /healthz (set by CI/CD).
  COMMIT_SHA: z.string().default("unknown"),
  BUILD_ID: z.string().default("local"),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config {
  nodeEnv: Env["NODE_ENV"];
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  festivalTimezone: string;
  defaultBufferMinutes: number;
  auth: {
    issuer: string;
    audience: string;
    jwksUri?: string;
    devJwksFile?: string;
  };
  tmdb: {
    baseUrl: string;
    token?: string;
    timeoutMs: number;
    maxRetries: number;
  };
  release: { commitSha: string; buildId: string };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const env = EnvSchema.parse(source);
  if (env.NODE_ENV === "production" && env.DEV_AUTH_JWKS_FILE) {
    throw new Error("DEV_AUTH_JWKS_FILE must not be set in production");
  }
  if (env.NODE_ENV === "production" && (!env.AUTH_ISSUER || !env.AUTH_AUDIENCE || !env.AUTH_JWKS_URI)) {
    throw new Error("AUTH_ISSUER, AUTH_AUDIENCE and AUTH_JWKS_URI are required in production");
  }
  const corsOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  if (corsOrigins.includes("*")) throw new Error("CORS_ORIGINS must list exact origins, not *");
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    corsOrigins,
    festivalTimezone: env.FESTIVAL_TIMEZONE,
    defaultBufferMinutes: env.DEFAULT_BUFFER_MINUTES,
    auth: {
      issuer: env.AUTH_ISSUER ?? "https://reelschedule.local/dev-issuer",
      audience: env.AUTH_AUDIENCE ?? "api://reelschedule",
      ...(env.AUTH_JWKS_URI ? { jwksUri: env.AUTH_JWKS_URI } : {}),
      ...(env.DEV_AUTH_JWKS_FILE ? { devJwksFile: env.DEV_AUTH_JWKS_FILE } : {}),
    },
    tmdb: {
      baseUrl: env.TMDB_BASE_URL,
      ...(env.TMDB_READ_TOKEN ? { token: env.TMDB_READ_TOKEN } : {}),
      timeoutMs: env.TMDB_TIMEOUT_MS,
      maxRetries: env.TMDB_MAX_RETRIES,
    },
    release: { commitSha: env.COMMIT_SHA, buildId: env.BUILD_ID },
  };
}
