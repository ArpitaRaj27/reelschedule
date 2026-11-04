import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { appliedVersions, migrateDown, migrateUp } from "../src/migrator.js";

// Usage: tsx scripts/migrate.ts up | down [steps] | status
const [command = "up", stepsArg] = process.argv.slice(2);
const pool = createPool(loadConfig().databaseUrl);
try {
  if (command === "up") {
    const applied = await migrateUp(pool, console.log);
    console.log(applied.length ? `Applied ${applied.length} migration(s)` : "Already up to date");
  } else if (command === "down") {
    const steps = Number(stepsArg ?? 1);
    const reverted = await migrateDown(pool, steps, console.log);
    console.log(`Reverted ${reverted.length} migration(s)`);
  } else if (command === "status") {
    console.log((await appliedVersions(pool)).join("\n") || "(none applied)");
  } else {
    throw new Error(`Unknown command ${command}`);
  }
} finally {
  await pool.end();
}
