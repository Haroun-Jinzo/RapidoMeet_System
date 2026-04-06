/**
 * The lifecycle of a single action in the pipeline.
 *
 * pending    → action created by router.ts, not yet executed
 * confirmed  → user approved via Confirmation Gate (for critical actions)
 * refused    → user rejected via Confirmation Gate
 * timeout    → user did not respond within 5 minutes
 * executed   → dispatcher.ts ran it successfully
 */
export type ActionStatus =
  | "pending"
  | "confirmed"
  | "refused"
  | "timeout"
  | "executed";

/**
 * The 4 output channels OpenClaw distributes reports to.
 * Each channel has a different message format.
 */
