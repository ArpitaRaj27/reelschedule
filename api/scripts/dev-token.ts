import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from "jose";
import { ROLES, SCOPES } from "../src/auth.js";
import { loadConfig } from "../src/config.js";

/**
 * LOCAL DEVELOPMENT ONLY. Mints RS256 access tokens signed by a local key so you can
 * exercise roles and scopes before the Entra ID app registration exists.
 * The API only trusts these when DEV_AUTH_JWKS_FILE points at the generated jwks.json
 * and NODE_ENV is not production (config.ts refuses it in production).
 *
 *   npm run dev-token -- programmer      → Festival.Programmer + Schedule.Read Schedule.Write
 *   npm run dev-token -- viewer          → Festival.Viewer + Schedule.Read
 *   npm run dev-token -- readonly-prog   → Festival.Programmer + Schedule.Read only
 */
const dir = path.resolve(".dev-auth");
const privFile = path.join(dir, "private.jwk.json");
const jwksFile = path.join(dir, "jwks.json");

if (!existsSync(privFile)) {
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const pub = { ...(await exportJWK(publicKey)), kid: "dev-1", alg: "RS256", use: "sig" };
  writeFileSync(privFile, JSON.stringify({ ...(await exportJWK(privateKey)), kid: "dev-1", alg: "RS256" }));
  writeFileSync(jwksFile, JSON.stringify({ keys: [pub] }, null, 2));
  console.error(`Created dev keys in ${dir}. Set DEV_AUTH_JWKS_FILE=${jwksFile}`);
}

const profiles: Record<string, { roles: string[]; scp: string; sub: string }> = {
  programmer: { roles: [ROLES.programmer], scp: `${SCOPES.read} ${SCOPES.write}`, sub: "dev-programmer-1" },
  programmer2: { roles: [ROLES.programmer], scp: `${SCOPES.read} ${SCOPES.write}`, sub: "dev-programmer-2" },
  viewer: { roles: [ROLES.viewer], scp: SCOPES.read, sub: "dev-viewer-1" },
  "readonly-prog": { roles: [ROLES.programmer], scp: SCOPES.read, sub: "dev-programmer-ro" },
};
const name = process.argv[2] ?? "programmer";
const profile = profiles[name];
if (!profile) throw new Error(`Unknown profile ${name}; use one of ${Object.keys(profiles).join(", ")}`);

const config = loadConfig();
const key = await importJWK(JSON.parse(readFileSync(privFile, "utf8")) as JWK, "RS256");
const token = await new SignJWT({ roles: profile.roles, scp: profile.scp })
  .setProtectedHeader({ alg: "RS256", kid: "dev-1" })
  .setIssuer(config.auth.issuer)
  .setAudience(config.auth.audience)
  .setSubject(profile.sub)
  .setIssuedAt()
  .setExpirationTime("8h")
  .sign(key);
console.log(token);
