export type ProgressStep =
  | "started"
  | "transcription"
  | "skill_detection"
  | "extraction"
  | "routing"
  | "action"
  | "confirmation"
  | "complete"
  | "cancelled"
  | "error";

export interface ProgressEvent {
  sessionId: string;
  step: ProgressStep;
  message: string;
  progress: number;
  detail?: string;
  error?: string;
  timestamp: string;
  state?: string;
  pending_actions?: Array<{
    id: string;
    title: string;
    summary?: string;
    destination?: string;
    action_type?: string;
  }>;
}

export type ProgressSubscriber = (event: ProgressEvent) => void;

export interface ProgressEmitInput {
  sessionId: string;
  step: ProgressStep;
  message: string;
  progress: number;
  detail?: string;
  error?: string;
  state?: string;
  pending_actions?: ProgressEvent["pending_actions"];
}

const TERMINAL_STEPS = new Set<ProgressStep>(["complete", "cancelled", "error"]);

/** Map action index (0-based) into the 70–90 progress band. */
export function actionProgressPercent(index: number, total: number): number {
  if (total <= 0) return 90;
  return Math.round(70 + ((index + 1) / total) * 20);
}

class ProgressBus {
  private subscribers = new Map<string, Set<ProgressSubscriber>>();
  private buffers = new Map<string, ProgressEvent[]>();
  private terminalSessions = new Set<string>();

  emit(input: ProgressEmitInput): ProgressEvent {
    const event: ProgressEvent = {
      ...input,
      progress: Math.min(100, Math.max(0, Math.round(input.progress))),
      timestamp: new Date().toISOString(),
    };

    if (!this.buffers.has(input.sessionId)) {
      this.buffers.set(input.sessionId, []);
    }
    this.buffers.get(input.sessionId)!.push(event);

    if (TERMINAL_STEPS.has(event.step)) {
      this.terminalSessions.add(input.sessionId);
    }

    const subs = this.subscribers.get(input.sessionId);
    subs?.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.warn("[ProgressBus] Subscriber error:", (err as Error).message);
      }
    });

    return event;
  }

  subscribe(sessionId: string, callback: ProgressSubscriber): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId)!.add(callback);

    // Replay buffered events for clients that connect after processing started
    for (const event of this.buffers.get(sessionId) ?? []) {
      callback(event);
    }

    return () => {
      this.subscribers.get(sessionId)?.delete(callback);
      if (this.subscribers.get(sessionId)?.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  isTerminal(sessionId: string): boolean {
    return this.terminalSessions.has(sessionId);
  }

  getBuffer(sessionId: string): readonly ProgressEvent[] {
    return this.buffers.get(sessionId) ?? [];
  }

  /** Remove session state after all SSE clients disconnect post-terminal. */
  cleanup(sessionId: string): void {
    if (!this.terminalSessions.has(sessionId)) return;
    if (this.subscribers.has(sessionId)) return;
    this.buffers.delete(sessionId);
    this.terminalSessions.delete(sessionId);
  }
}

export const progressBus = new ProgressBus();
