import { PendingActionStatus } from "../interfaces/IPendingAction";

export function toDbPendingActionStatus(status: PendingActionStatus | string): string {
  switch (status) {
    case "refused":
      return "rejected";
    case "confirmed":
      return "approved";
    default:
      return status;
  }
}

export function fromDbPendingActionStatus(status: string): PendingActionStatus {
  switch (status) {
    case "rejected":
      return "refused";
    case "confirmed":
      return "approved";
    default:
      return status as PendingActionStatus;
  }
}
