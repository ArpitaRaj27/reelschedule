import { readFileSync } from "node:fs";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createLocalJWKSet, createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey, type JSONWebKeySet } from "jose";
import type { Config } from "./config.js";
import { HttpError } from "./errors.js";

/**
 * Access-token validation for the REST API and MCP server.
 *
 * Every protected request must carry `Authorization: Bearer <JWT>` issued by the
 * identity provider (Microsoft Entra ID in production). The server checks:
 *   - signature against the provider's JWKS (public signing keys)
 *   - issuer (iss) and audience (aud) match this API
 *   - expiry (exp) and not-before (nbf), with 30 s clock tolerance
 *   - roles (app roles from the `roles` claim) and scopes (`scp` claim)
 * Hiding a button in the UI is not authorization: these checks run on every write.
 */

export const ROLES = {
  programmer: "Festival.Programmer",
  viewer: "Festival.Viewer",
} as const;

export const SCOPES = {
  read: "Schedule.Read",
  write: "Schedule.Write",
} as const;

export interface Principal {
  /** Stable subject identifier from the validated token (Entra `oid`, else `sub`). */
  sub: string;
  roles: string[];
  scopes: string[];
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export function createTokenVerifier(opts: {
  issuer: string;
  audience: string;
  getKey: JWTVerifyGetKey;
}): TokenVerifier {
  return {
    async verify(token: string): Promise<Principal> {
      try {
        const { payload } = await jwtVerify(token, opts.getKey, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ["RS256"],
          clockTolerance: 30,
          requiredClaims: ["exp", "sub"],
        });
        const sub = typeof payload.oid === "string" ? payload.oid : String(payload.sub);
        const roles = Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === "string") : [];
        const rawScopes = typeof payload.scp === "string" ? payload.scp : typeof payload.scope === "string" ? payload.scope : "";
        const scopes = rawScopes.split(" ").filter(Boolean);
        return { sub, roles, scopes };
      } catch (err) {
        const reason =
          err instanceof joseErrors.JWTExpired
            ? "Token has expired"
            : err instanceof joseErrors.JWTClaimValidationFailed
              ? `Token claim check failed (${err.claim})`
              : "Token is invalid";
        throw new HttpError(401, "invalid_token", reason);
      }
    },
  };
}

/** Build the verifier from configuration: remote JWKS in production, a local dev JWKS file otherwise. */
export function verifierFromConfig(config: Config): TokenVerifier {
  if (config.auth.jwksUri) {
    return createTokenVerifier({
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      getKey: createRemoteJWKSet(new URL(config.auth.jwksUri)),
    });
  }
  if (config.auth.devJwksFile && config.nodeEnv !== "production") {
    const jwks = JSON.parse(readFileSync(config.auth.devJwksFile, "utf8")) as JSONWebKeySet;
    return createTokenVerifier({
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      getKey: createLocalJWKSet(jwks),
    });
  }
  // No identity provider configured: every protected route answers 401.
  return {
    verify: async () => {
      throw new HttpError(401, "invalid_token", "No identity provider is configured on this server");
    },
  };
}

export function getPrincipal(res: Response): Principal | undefined {
  return res.locals.principal as Principal | undefined;
}

export function requirePrincipal(res: Response): Principal {
  const p = getPrincipal(res);
  if (!p) throw new HttpError(401, "unauthenticated", "Sign in is required");
  return p;
}

/** Parses the bearer token if present. Public routes still work without one. */
export function authenticate(verifier: TokenVerifier): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    if (!header) return next();
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) return next(new HttpError(401, "invalid_token", "Authorization header must be 'Bearer <token>'"));
    try {
      res.locals.principal = await verifier.verify(match[1]);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Require a signed-in principal holding `role` and every listed scope. */
export function requireAccess(role: string, ...scopes: string[]): RequestHandler {
  return (_req, res, next) => {
    const p = getPrincipal(res);
    if (!p) {
      res.set("WWW-Authenticate", 'Bearer realm="reelschedule"');
      return next(new HttpError(401, "unauthenticated", "Sign in is required"));
    }
    if (!p.roles.includes(role)) {
      return next(new HttpError(403, "forbidden", `The ${role} role is required for this action`));
    }
    const missing = scopes.filter((s) => !p.scopes.includes(s));
    if (missing.length) {
      return next(new HttpError(403, "insufficient_scope", `Token is missing scope: ${missing.join(", ")}`));
    }
    next();
  };
}
