import { ActionStatus } from "../interfaces/ActionStatus";
import { IAction } from "../interfaces/IAction";

/** Higher rank = more advanced in the approval/execution lifecycle. */
const STATUS_RANK: Record<ActionStatus, number> = {
  pending: 0,
  confirmed: 1,
  executed: 2,
  refused: -1,
  timeout: -1,
};

function statusRank(status: ActionStatus): number {
  return STATUS_RANK[status] ?? 0;
}

/**
 * Merge persisted action states into the in-memory pipeline copy.
 * Never downgrades confirmed/executed/refused back to pending.
 */
export function mergeActionStatuses(
  target: IAction[],
  source: IAction[] | undefined
): void {
  if (!source?.length) return;

  const byId = new Map(source.map((a) => [a.id, a]));

  for (const action of target) {
    const remote = byId.get(action.id);
    if (!remote) continue;

    if (statusRank(remote.status) > statusRank(action.status)) {
      action.status = remote.status;
    }

    if (remote.result != null) action.result = remote.result;
    if (remote.execution_status != null) action.execution_status = remote.execution_status;
    if (remote.execution_result != null) action.execution_result = remote.execution_result;
    if (remote.updated_at != null) action.updated_at = remote.updated_at;
  }
}
