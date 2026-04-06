/**
 * One formatted report in all 4 channel formats simultaneously.
 * formatter.ts produces this, notifier.ts consumes it.
 */
export interface IFormattedReport {
  telegram: string;   // Telegram MarkdownV2 format, max 4096 chars
  whatsapp: string;   // Plain text, emojis OK, max 1600 chars
  discord:  string;   // Discord markdown format
  email: {
    subject: string;
    html:    string;   // Full HTML email with inline CSS
    text:    string;   // Plain text fallback for email clients without HTML
  };
}

/**
 * C4 Component: Report Formatter
 * File: src/formatter.ts
 *
 * The ONLY module that builds message strings.
 * Pure function — no network calls, no database access.
 * Input: session + results → Output: formatted strings.
 */
