/**
 * Priority level for tasks extracted from a meeting.
 */
export type Priority = "high" | "medium" | "low";

/**
 * The lifecycle of a single action in the pipeline.
 *
 * pending    → action created by router.ts, not yet executed
 * confirmed  → user approved via Confirmation Gate (for critical actions)
 * refused    → user rejected via Confirmation Gate
 * timeout    → user did not respond within 5 minutes
 * executed   → dispatcher.ts ran it successfully
 */
