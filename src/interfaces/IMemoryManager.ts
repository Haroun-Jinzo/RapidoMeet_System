import { ITask } from "./ITask";
import { IPendingAction, IPendingActionInsert, PendingActionStatus } from "./IPendingAction";

export interface IMemoryManager {
  saveTask(
    task: ITask & { sessionId: string; userId: string }
  ): Promise<string>;

  savePendingAction(
    action: IPendingActionInsert,
    extra?: { meetingId?: string; display?: Record<string, unknown> }
  ): Promise<void>;

  updatePendingActionStatus(
    actionId: string,
    status: PendingActionStatus
  ): Promise<void>;
  getPendingAction(actionId: string): Promise<IPendingAction | null>;
}
