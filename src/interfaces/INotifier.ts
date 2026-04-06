import { NotificationChannel } from "./NotificationChannel";
import { IFormattedReport } from "./IFormattedReport";
import { INotificationResult } from "./INotificationResult";

/**
 * C4 Component: Notifier
 * File: src/notifier.ts
 *
 * The ONLY module that calls OpenClaw to send messages.
 * Receives a formatted report → distributes to all configured channels.
 */
export interface INotifier {
  /**
   * Send the report to all specified channels simultaneously.
   * Uses Promise.allSettled — one channel failing does not stop others.
   */
  notifyAll(
    report:    IFormattedReport,
    channels:  NotificationChannel[],
    sessionId: string
  ): Promise<INotificationResult[]>;

  /**
   * Send a single message to one specific channel.
   * Used by the Confirmation Gate to notify the user of a pending action.
   */
  notify(
    channel:   NotificationChannel,
    message:   string,
    sessionId: string
  ): Promise<INotificationResult>;
}

// SECTION 10 — SKILL REGISTRY (skill-loader.ts)
// Manages the .md behaviour files that customise the agent per meeting type.

/**
 * One loaded Skill file with its parsed metadata.
 */
