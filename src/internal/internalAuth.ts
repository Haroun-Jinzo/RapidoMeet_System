import { Request, Response, NextFunction } from "express";

export const requireInternalAuth = (req: Request, res: Response, next: NextFunction) => {
  const internalSecret = process.env.INTERNAL_OPENCLAW_SECRET;
  
  if (!internalSecret) {
    console.error("Missing INTERNAL_OPENCLAW_SECRET config");
    return res.status(500).json({ error: "Internal Auth configuration missing" });
  }

  const providedSecret = req.header("X-Internal-Auth");

  if (!providedSecret || providedSecret !== internalSecret) {
    return res.status(401).json({ error: "Unauthorized access: invalid internal secret" });
  }

  next();
};
