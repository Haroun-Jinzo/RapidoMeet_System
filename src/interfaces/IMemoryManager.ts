import { ITask } from "./ITask";
import { IPendingAction, IPendingActionInsert, PendingActionStatus } from "./IPendingAction";

/**
 * C4 Component: Memory Manager
 * File: src/memory.ts
 *
 * The ONLY module allowed to query PostgreSQL directly for tasks and pending actions.
 */
export interface IMemoryManager {
  /**
   * Save a single task to PostgreSQL.
   * Returns the database-generated UUID.
   */
  saveTask(
    task: ITask & { sessionId: string; userId: string }
  ): Promise<string>;

  // ── Pending actions (Supabase — n8n approval flow) ───────────────────

  /** Persist a critical action awaiting Telegram / n8n approval. */
  savePendingAction(
    action: IPendingActionInsert,
    extra?: { meetingId?: string; display?: Record<string, unknown> }
  ): Promise<void>;

  /** Update status after user decision or n8n execution callback. */
  updatePendingActionStatus(
    actionId: string,
    status: PendingActionStatus
  ): Promise<void>;

  /** Lookup a pending action by action_id (used by internal callbacks). */
  getPendingAction(actionId: string): Promise<IPendingAction | null>;
}
