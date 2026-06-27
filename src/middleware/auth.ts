import { Request, Response, NextFunction } from "express";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import * as dotenv from "dotenv";

dotenv.config();

let supabaseAuthAdmin: SupabaseClient | null = null;

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
