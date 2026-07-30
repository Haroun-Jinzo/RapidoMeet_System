import { Request, Response, NextFunction } from "express";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import { createPublicKey } from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

let supabaseAuthAdmin: SupabaseClient | null = null;
const PRODUCTION_PROJECT_REF = "jrpjwggcabbxoqvaxuay";
type SupabaseJwk = Record<string, unknown> & { kid?: string };
const jwksCache = new Map<string, { keys: SupabaseJwk[]; expiresAt: number }>();

function getExpectedProjectRef(): string {
  return process.env.SUPABASE_PROJECT_REF?.trim() || PRODUCTION_PROJECT_REF;
}

function getExpectedIssuer(): string {
  return process.env.JWT_ISSUER?.trim()
    || `https://${getExpectedProjectRef()}.supabase.co/auth/v1`;
}

function decodeServiceKeyRef(key: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] || "", "base64url").toString());
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

/** Fail startup before requests can be authenticated against the wrong project. */
export function assertAuthConfiguration(): void {
  const expectedRef = getExpectedProjectRef();
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceKey) {
    throw new Error("[Auth] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const urlRef = new URL(url).hostname.split(".")[0];
  const keyRef = decodeServiceKeyRef(serviceKey);
  if (urlRef !== expectedRef || (keyRef && keyRef !== expectedRef)) {
    throw new Error(
      `[Auth] Supabase project mismatch: expected ${expectedRef}, URL=${urlRef}, service-key=${keyRef || "unknown"}`,
    );
  }
}

function getSupabaseAuthAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;

  if (!supabaseAuthAdmin) {
    supabaseAuthAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAuthAdmin;
}

/**
 * Accept JWT from Authorization header or query string (for EventSource / SSE).
 * EventSource cannot send custom headers — clients may use ?token= or ?access_token=
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }

  const fromQuery = req.query.token ?? req.query.access_token;
  if (typeof fromQuery === "string" && fromQuery.trim()) {
    return fromQuery.trim();
  }
  if (Array.isArray(fromQuery) && typeof fromQuery[0] === "string" && fromQuery[0].trim()) {
    return fromQuery[0].trim();
  }

  return null;
}

function getVerifyOptions(): jwt.VerifyOptions {
  const verifyOptions: jwt.VerifyOptions = {
    audience: process.env.JWT_AUDIENCE || "authenticated",
  };

  if (process.env.JWT_ISSUER) {
    verifyOptions.issuer = process.env.JWT_ISSUER;
  } else if (process.env.SUPABASE_URL) {
    verifyOptions.issuer = `${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
  }

  return verifyOptions;
}

function attachUser(req: Request, userId: string, extra: Record<string, unknown> = {}): void {
  (req as Request & { user: { id: string } }).user = {
    id: userId,
    ...extra,
  };
}

async function verifySupabaseAccessToken(
  token: string
): Promise<{ userId: string; extra: Record<string, unknown> } | null> {
  const admin = getSupabaseAuthAdmin();
  if (!admin) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    console.warn("[Auth] Supabase getUser failed:", error?.message ?? "no user");
    return null;
  }

  return {
    userId: data.user.id,
    extra: { email: data.user.email },
  };
}

async function getJwks(issuer: string, forceRefresh = false): Promise<SupabaseJwk[]> {
  const cached = jwksCache.get(issuer);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(`${issuer}/.well-known/jwks.json`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`JWKS endpoint returned ${response.status}`);

  const body = await response.json() as { keys?: SupabaseJwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(issuer, { keys, expiresAt: Date.now() + 10 * 60_000 });
  return keys;
}

/**
 * Verify Supabase's current asymmetric access tokens without relying on an
 * admin API request. The issuer is pinned to this application's project.
 */
async function verifyWithSupabaseJwks(token: string): Promise<{ userId: string } | null> {
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === "string") return null;
    if (decoded.header.alg !== "ES256" || !decoded.header.kid) return null;

    const issuer = getExpectedIssuer();
    const claims = decoded.payload;
    if (typeof claims === "string") return null;
    if (claims.iss !== issuer || typeof claims.sub !== "string") return null;

    let keys = await getJwks(issuer);
    let jwk = keys.find(key => key.kid === decoded.header.kid);
    if (!jwk) {
      keys = await getJwks(issuer, true);
      jwk = keys.find(key => key.kid === decoded.header.kid);
    }
    if (!jwk) return null;

    const publicKey = createPublicKey(
      { key: jwk, format: "jwk" } as Parameters<typeof createPublicKey>[0],
    );
    const verified = jwt.verify(token, publicKey, {
      algorithms: ["ES256"],
      audience: process.env.JWT_AUDIENCE || "authenticated",
      issuer,
    }) as jwt.JwtPayload;

    return typeof verified.sub === "string" ? { userId: verified.sub } : null;
  } catch (err) {
    console.warn("[Auth] Supabase JWKS verify failed:", (err as Error).message);
    return null;
  }
}

function verifyWithJwtSecret(token: string): { userId: string } | null {
  const secret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (!secret) return null;

  try {
    const decoded = jwt.verify(token, secret, getVerifyOptions()) as {
      sub: string;
      [key: string]: unknown;
    };
    return { userId: decoded.sub };
  } catch (err) {
    console.warn("[Auth] JWT secret verify failed:", (err as Error).message);
    return null;
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const internalAuth = req.headers["x-internal-auth"] || req.headers["x-internal-token"];
    if (internalAuth && internalAuth === process.env.INTERNAL_INGEST_SECRET) {
      const providedUserId = req.headers["x-internal-user-id"] as string;
      attachUser(req, providedUserId || "00000000-0000-0000-0000-000000000000");
      return next();
    }

    const token = extractBearerToken(req);

    if (!token && process.env.BYPASS_AUTH === "true") {
      const bypassUserId = req.headers["x-bypass-user-id"] as string;
      attachUser(req, bypassUserId || "11111111-1111-1111-1111-111111111111");
      return next();
    }

    if (!token) {
      return res.status(401).json({ error: "Missing or invalid authorization" });
    }

    // Supabase's current ES256 access tokens can be verified locally against
    // public JWKS. Do this first so authentication does not depend on an admin
    // API round trip or fail because that service is temporarily slow.
    const fromJwks = await verifyWithSupabaseJwks(token);
    if (fromJwks) {
      attachUser(req, fromJwks.userId);
      return next();
    }

    // Compatibility fallback for legacy HS256 tokens and projects that have
    // not migrated to asymmetric signing keys.
    const fromSupabase = await verifySupabaseAccessToken(token);
    if (fromSupabase) {
      attachUser(req, fromSupabase.userId, fromSupabase.extra);
      return next();
    }

    const fromSecret = verifyWithJwtSecret(token);
    if (fromSecret) {
      attachUser(req, fromSecret.userId);
      return next();
    }

    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  } catch (err) {
    console.error("[Auth] Unexpected error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
};
