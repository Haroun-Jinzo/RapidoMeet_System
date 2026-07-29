const cancelledSessions = new Set<string>();

export class PipelineCancelledError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Pipeline ${sessionId} was cancelled`);
    this.name = "PipelineCancelledError";
  }
}

export function requestPipelineCancellation(sessionId: string): void {
  cancelledSessions.add(sessionId);
}

export function throwIfPipelineCancelled(sessionId: string): void {
  if (cancelledSessions.has(sessionId)) {
    throw new PipelineCancelledError(sessionId);
  }
}

export function clearPipelineCancellation(sessionId: string): void {
  cancelledSessions.delete(sessionId);
}
