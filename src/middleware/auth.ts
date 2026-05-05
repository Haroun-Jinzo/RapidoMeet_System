import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import * as dotenv from "dotenv";

dotenv.config();

function getJwksUri(): string {
  if (process.env.JWKS_URI) return process.env.JWKS_URI;
  if (process.env.SUPABASE_URL) {
    const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
    return `${baseUrl}/auth/v1/jwks`; // Supabase convention
  }
  return "";
}

const client = jwksClient({
  jwksUri: getJwksUri(),
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 3600000, // 1 hour
  rateLimit: true,
  jwksRequestsPerMinute: 10
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      return callback(err || new Error("Key not found in JWKS"));
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  // Allow internal sevice calls
  const internalAuth = req.headers["x-internal-auth"] || req.headers["x-internal-token"];
  console.log("////////////////////////////////// providedUserId:", req.headers["x-internal-user-id"], "/////////////////////////////////////////");
  if(internalAuth && internalAuth === process.env.INTERNAL_INGEST_SECRET) 
  {
    const providedUserId = req.headers["x-internal-user-id"] as string;
    (req as any).user = { id: providedUserId || "00000000-0000-0000-0000-000000000000" };
    return next();
  }

  // Allow bypassing auth in development if BYPASS_AUTH is set to "true"
  if (process.env.BYPASS_AUTH === "true") {
    const bypassUserId = req.headers["x-bypass-user-id"] as string;
    (req as any).user = { id: bypassUserId || "11111111-1111-1111-1111-111111111111" };
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];

  const verifyOptions: jwt.VerifyOptions = {
    // Optional checks depending on requirements check the env, fallback strings
    audience: process.env.JWT_AUDIENCE || "authenticated",
  };
  
  if (process.env.JWT_ISSUER) verifyOptions.issuer = process.env.JWT_ISSUER;
  else if (process.env.SUPABASE_URL) verifyOptions.issuer = `${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;

  // Provide fallback to secret if JWKS is not reachable or wanted in dev testing
  if (!getJwksUri() && process.env.SUPABASE_JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, verifyOptions) as { sub: string; [key: string]: any };
      (req as any).user = { id: decoded.sub, ...decoded };
      return next();
    } catch (err: any) {
      return res.status(401).json({ error: "Unauthorized: Invalid token (symmetric)" });
    }
  }

  jwt.verify(token, getKey, verifyOptions, (err, decoded) => {
    if (err) {
      console.error("JWKS Verification failed:", err.message);
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    const payload = decoded as { sub: string; [key: string]: any };
    
    // Attach user payload
    (req as any).user = {
      id: payload.sub,
      ...payload
    };

    next();
  });
};
