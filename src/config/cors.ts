/**
 * Build CORS options from CORS_ORIGIN env.
 * Supports comma-separated list; strips trailing slashes for Origin matching.
 */
export function buildCorsOptions(): {
  origin: (
    requestOrigin: string | undefined,
    callback: (err: Error | null, allow?: boolean | string) => void
  ) => void;
  credentials: boolean;
} {
  const raw =
    process.env.CORS_ORIGIN?.trim() ||
    "http://localhost:8080,http://localhost:8081";

  const allowed = raw
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);

  // Always allow common local Vite ports during development
  for (const local of ["http://localhost:8080", "http://localhost:8081", "http://127.0.0.1:8080", "http://127.0.0.1:8081"]) {
    if (!allowed.includes(local)) allowed.push(local);
  }

  return {
    credentials: true,
    origin(requestOrigin, callback) {
      if (!requestOrigin) {
        callback(null, true);
        return;
      }
      const normalized = requestOrigin.replace(/\/$/, "");
      if (allowed.includes(normalized) || allowed.includes("*")) {
        callback(null, normalized);
        return;
      }
      console.warn(`[CORS] Blocked origin: ${requestOrigin} (allowed: ${allowed.join(", ")})`);
      callback(null, false);
    },
  };
}
