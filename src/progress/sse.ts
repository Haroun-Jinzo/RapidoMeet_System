import { Request, Response } from "express";
import { progressBus, ProgressEvent } from "./ProgressBus";

const HEARTBEAT_MS = 15_000;

function writeSse(res: Response, event: ProgressEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeHeartbeat(res: Response): void {
  res.write(": heartbeat\n\n");
}

/**
 * SSE handler for GET /sessions/:id/progress
 * Caller must verify session ownership before invoking.
 */
export function streamSessionProgress(
  req: Request,
  res: Response,
  sessionId: string
): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    progressBus.cleanup(sessionId);
    if (!res.writableEnded) {
      res.end();
    }
  };

  const heartbeat = setInterval(() => {
    if (!closed) writeHeartbeat(res);
  }, HEARTBEAT_MS);

  const unsubscribe = progressBus.subscribe(sessionId, (event) => {
    if (closed) return;
    writeSse(res, event);
    if (event.step === "complete" || event.step === "error") {
      close();
    }
  });

  // If pipeline already finished before subscribe replay fired close
  if (progressBus.isTerminal(sessionId)) {
    const buffer = progressBus.getBuffer(sessionId);
    const last = buffer[buffer.length - 1];
    if (last && (last.step === "complete" || last.step === "error")) {
      // Replay already sent via subscribe; close after a tick
      setImmediate(close);
    }
  }

  req.on("close", close);
  req.on("aborted", close);
}
