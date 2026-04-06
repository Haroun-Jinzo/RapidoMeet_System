/**
 * The 4 output channels OpenClaw distributes reports to.
 * Each channel has a different message format.
 */
export type NotificationChannel =
  | "telegram"
  | "whatsapp"
  | "discord"
  | "email";

// SECTION 2 — SESSION (session.ts)
// Represents one meeting being processed from start to finish.

/**
 * A session is the central object that travels through the entire pipeline.
 * Created when a meeting starts → updated at each step → saved to DB at end.
 *
 * Think of it as a backpack that holds everything we know about
 * one specific meeting at any point in time.
 */
