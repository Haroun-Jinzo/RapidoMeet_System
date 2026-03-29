/**
 * Request Correlation Middleware
 * 
 * This middleware assigns a unique correlation ID to each HTTP request,
 * enabling end-to-end request tracing across all service modules and logs.
 * The correlation ID is stored in request context and should be included
 * in all logs and error messages for debugging.
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

/** Type definition for Request with correlation context */
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

/**
 * Generates a unique correlation ID for request tracing
 * Format: timestamp hex + random bytes for uniqueness
 * 
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId(): string {
  const timestamp = Date.now().toString(16);
  const random = randomBytes(8).toString('hex');
  return `${timestamp}-${random}`;
}

/**
 * Express middleware that adds a correlation ID to each request
 * 
 * Usage in Express app:
 *   app.use(correlationMiddleware);
 * 
 * After this middleware runs, response headers will include:
 *   X-Correlation-ID: <unique-id>
 * 
 * And request object will have:
 *   req.correlationId = '<unique-id>'
 * 
 * All logs should include this ID for tracing:
 *   console.log(`[${req.correlationId}] Action executed`);
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Get correlation ID from request header if present (for traced calls)
  // Otherwise generate a new one
  const correlationId =
    (req.headers['x-correlation-id'] as string) || generateCorrelationId();

  // Attach to request for use in handlers
  req.correlationId = correlationId;

  // Add to response headers so client can track their request
  res.setHeader('X-Correlation-ID', correlationId);

  // ⚠️ TODO: Store correlationId in AsyncLocalStorage for log context
  // This would allow logger to automatically include it without passing through call stack:
  //   import { AsyncLocalStorage } from 'async_hooks';
  //   const asyncLocalStorage = new AsyncLocalStorage();
  //   asyncLocalStorage.run(correlationId, () => next());

  next();
}

/**
 * Utility function to create a correlated log message
 * Automatically includes correlation ID prefix if available
 * 
 * @param correlationId - The request's correlation ID
 * @param level - Log level (info, warn, error, debug)
 * @param message - The log message
 * @param data - Optional additional data to log
 */
export function logWithCorrelation(
  correlationId: string,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  data?: Record<string, unknown>
): void {
  const prefix = `[${correlationId}]`;
  const logData = data ? JSON.stringify(data) : '';
  const fullMessage = `${prefix} ${message} ${logData}`.trim();

  // In production, this should use a proper logger (Winston, Pino, etc.)
  console.log(`${level.toUpperCase()}: ${fullMessage}`);
}
