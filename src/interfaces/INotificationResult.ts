import { NotificationChannel } from "./NotificationChannel";

/**
 * Result of one notification attempt on one channel.
 */
export interface INotificationResult {
  channel: NotificationChannel;
  success: boolean;
  error?:  string;  // Only present if success is false
}

/**
 * C4 Component: Notifier
 * File: src/notifier.ts
 *
 * The ONLY module that calls OpenClaw to send messages.
 * Receives a formatted report → distributes to all configured channels.
 */
