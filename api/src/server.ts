import { createApp } from "./app.js";
import { verifierFromConfig } from "./auth.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { EventHub } from "./events.js";
import { log } from "./logger.js";
import { migrateUp } from "./migrator.js";
import { TmdbClient } from "./tmdb.js";
import { seed } from "../scripts/seed.js";

// Local development convenience: read api/.env if present (real environment variables win).
// Never in production, where every setting comes from the host's environment.
if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env file: rely on the environment */
  }
}

const config = loadConfig();
const db = createPool(config.databaseUrl);

if (config.startup.runMigrations) {
  const applied = await migrateUp(db, (m) => log.info("migration", { step: m }));
  log.info("migrations_done", { applied });
}
if (config.startup.seedDemoData) {
  await seed(config.databaseUrl, config.defaultBufferMinutes); // idempotent: fixed ids, ON CONFLICT DO NOTHING
  log.info("demo_data_ready");
}

const hub = new EventHub(db);
await hub.start();

const tmdb = new TmdbClient({
  baseUrl: config.tmdb.baseUrl,
  ...(config.tmdb.token ? { token: config.tmdb.token } : {}),
  timeoutMs: config.tmdb.timeoutMs,
  maxRetries: config.tmdb.maxRetries,
  db,
});

const app = createApp({ config, db, verifier: verifierFromConfig(config), tmdb, hub });
const server = app.listen(config.port, () => {
  log.info("api_started", {
    port: config.port,
    corsOrigins: config.corsOrigins,
    tmdbConfigured: Boolean(config.tmdb.token),
    auth: !config.authConfigured ? "disabled (read-only)" : config.auth.jwksUri ? "jwks" : "dev-jwks",
    commit: config.release.commitSha,
  });
});

const shutdown = async () => {
  server.close();
  await hub.stop();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
