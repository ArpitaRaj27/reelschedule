import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const AUTH = {
  AUTH_ISSUER: "https://login.microsoftonline.com/tenant/v2.0",
  AUTH_AUDIENCE: "api://reelschedule",
  AUTH_JWKS_URI: "https://login.microsoftonline.com/tenant/discovery/v2.0/keys",
};

describe("configuration", () => {
  it("runs production read-only (fail closed) when no identity provider is configured", () => {
    const c = loadConfig({ NODE_ENV: "production" });
    expect(c.authConfigured).toBe(false);
  });

  it("enables sign-in in production only with all three identity settings", () => {
    expect(loadConfig({ NODE_ENV: "production", ...AUTH }).authConfigured).toBe(true);
    expect(() => loadConfig({ NODE_ENV: "production", AUTH_ISSUER: AUTH.AUTH_ISSUER })).toThrow(/all of AUTH_ISSUER/);
  });

  it("refuses development signing keys in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DEV_AUTH_JWKS_FILE: ".dev-auth/jwks.json" })).toThrow(/must not be set in production/);
  });

  it("refuses a wildcard CORS origin", () => {
    expect(() => loadConfig({ CORS_ORIGINS: "https://a.example, *" })).toThrow(/exact origins/);
  });

  it("reports Render's commit as the release identity", () => {
    const c = loadConfig({ RENDER_GIT_COMMIT: "abc1234", RENDER_SERVICE_NAME: "reelschedule-api" });
    expect(c.release).toEqual({ commitSha: "abc1234", buildId: "reelschedule-api" });
    expect(loadConfig({ COMMIT_SHA: "override", RENDER_GIT_COMMIT: "abc1234" }).release.commitSha).toBe("override");
  });

  it("only runs startup migrations and demo data when asked", () => {
    expect(loadConfig({}).startup).toEqual({ runMigrations: false, seedDemoData: false });
    expect(loadConfig({ RUN_MIGRATIONS: "true", SEED_DEMO_DATA: "true" }).startup).toEqual({ runMigrations: true, seedDemoData: true });
  });
});
