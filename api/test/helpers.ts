import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { createApp } from "../src/app.js";
import { createTokenVerifier, ROLES, SCOPES } from "../src/auth.js";
import { loadConfig, type Config } from "../src/config.js";
import { createPool, type Db } from "../src/db.js";
import { EventHub } from "../src/events.js";
import { migrateUp } from "../src/migrator.js";
import { TmdbClient, type FetchLike } from "../src/tmdb.js";
import { seed } from "../scripts/seed.js";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/reelschedule_test";
export const ISSUER = "https://login.example.test/tenant/v2.0";
export const AUDIENCE = "api://reelschedule-test";

/** Drop everything and rebuild the test database from the migrations + synthetic seed. */
export async function resetDatabase(): Promise<void> {
  const db = createPool(TEST_DB);
  try {
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrateUp(db);
  } finally {
    await db.end();
  }
  await seed(TEST_DB, 15);
}

export interface Keys {
  privateKey: CryptoKey;
  otherKey: CryptoKey;
  jwks: { keys: object[] };
}

export async function makeKeys(): Promise<Keys> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-1", alg: "RS256" };
  return { privateKey, otherKey: other.privateKey, jwks: { keys: [jwk] } };
}

export async function token(
  keys: Keys,
  opts: {
    roles?: string[];
    scp?: string;
    sub?: string;
    iss?: string;
    aud?: string;
    exp?: string | number;
    signWith?: CryptoKey;
  } = {},
): Promise<string> {
  return new SignJWT({ roles: opts.roles ?? [ROLES.programmer], scp: opts.scp ?? `${SCOPES.read} ${SCOPES.write}` })
    .setProtectedHeader({ alg: "RS256", kid: "test-1" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setSubject(opts.sub ?? "test-programmer")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "10m")
    .sign(opts.signWith ?? keys.privateKey);
}

export interface TestContext {
  app: ReturnType<typeof createApp>;
  db: Db;
  hub: EventHub;
  keys: Keys;
  config: Config;
  close(): Promise<void>;
}

export async function makeApp(opts: { fetchImpl?: FetchLike; tmdbToken?: string; limits?: { writesPerMinute?: number; providerPerMinute?: number } } = {}): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB,
    CORS_ORIGINS: "https://festival.example",
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    COMMIT_SHA: "test-sha",
  });
  const db = createPool(TEST_DB);
  const hub = new EventHub(db);
  await hub.start();
  const keys = await makeKeys();
  const verifier = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, getKey: createLocalJWKSet(keys.jwks as never) });
  const tmdb = new TmdbClient({
    baseUrl: "https://tmdb.example.test/3",
    token: opts.tmdbToken ?? "test-tmdb-secret-token",
    timeoutMs: 200,
    maxRetries: 2,
    db,
    fetchImpl: opts.fetchImpl ?? (async () => new Response("{}", { status: 503 })),
    sleep: async () => {},
  });
  const app = createApp({ config, db, verifier, tmdb, hub, limits: opts.limits ?? { writesPerMinute: 1000, providerPerMinute: 1000 } });
  return {
    app,
    db,
    hub,
    keys,
    config,
    async close() {
      await hub.stop();
      await db.end();
    },
  };
}
