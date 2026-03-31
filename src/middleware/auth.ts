import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  if (!jwtSecret) {
    console.warn("SUPABASE_JWT_SECRET not configured. Failing auth safely.");
    return res.status(500).json({ error: "Internal server error: Missing auth configuration" });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as { sub: string; [key: string]: any };
    
    // Attach user payload, particularly the user id (sub)
    (req as any).user = {
      id: decoded.sub,
      ...decoded
    };

    next();
  } catch (err: any) {
    console.error("JWT Verification failed:", err.message);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};
