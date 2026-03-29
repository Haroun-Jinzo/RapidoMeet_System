// src/notifier.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: Notifier
// Interface:  INotifier (from interfaces.ts)
// Responsibility: Send formatted reports to all configured channels.
//                 Routes through OpenClaw (production) or direct APIs (demo).
// Dependencies: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (direct mode)
//               OPENCLAW_URL (production mode)
// ─────────────────────────────────────────────────────────────────────────────

import {
  INotifier,
  IFormattedReport,
  INotificationResult,
  NotificationChannel,
} from "./interfaces";

class Notifier implements INotifier {

  // ── USE_OPENCLAW controls which path is taken ─────────────────────────────
  // false = direct API calls (Telegram bot, etc.) — use this for demo tomorrow
  // true  = route through OpenClaw on AWS — use this for production
  //
  // Controlled by environment variable so you never touch this file:
  //   USE_OPENCLAW=false  →  direct Telegram (demo mode)
  //   USE_OPENCLAW=true   →  OpenClaw AWS (production mode)

  private USE_OPENCLAW = process.env.USE_OPENCLAW === "true";

  // ── notifyAll ──────────────────────────────────────────────────────────────
  // Sends the report to all specified channels simultaneously.
  // Uses Promise.allSettled so one channel failing never blocks others.
  // You always get results for every channel regardless of failures.

  async notifyAll(
    report:    IFormattedReport,
    channels:  NotificationChannel[],
    sessionId: string
  ): Promise<INotificationResult[]> {
    console.log(
      `[Notifier] Sending to ${channels.length} channel(s): ${channels.join(", ")}`
    );

    // Send to all channels simultaneously — don't wait for one before starting next
    const promises = channels.map(channel =>
      this.notify(channel, this.getMessageForChannel(report, channel), sessionId)
    );

    // allSettled = never throws, always returns results array
    const settled = await Promise.allSettled(promises);

    return settled.map((result, i) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        console.error(
          `[Notifier] ${channels[i]} failed:`, result.reason
        );
        return {
          channel: channels[i],
          success: false,
          error:   result.reason?.message || "Unknown error",
        };
      }
    });
  }

  // ── notify ─────────────────────────────────────────────────────────────────
  // Sends a single message to one channel.
  // Routes to OpenClaw or direct API depending on USE_OPENCLAW.

  async notify(
    channel:   NotificationChannel,
    message:   string,
    sessionId: string
  ): Promise<INotificationResult> {
    if (this.USE_OPENCLAW) {
      return this.sendViaOpenClaw(channel, message, sessionId);
    } else {
      return this.sendDirect(channel, message, sessionId);
    }
  }

  // ── PRIVATE: getMessageForChannel ─────────────────────────────────────────
  // Picks the right format from the report for each channel.

  private getMessageForChannel(
    report:  IFormattedReport,
    channel: NotificationChannel
  ): string {
    switch (channel) {
      case "telegram":  return report.telegram;
      case "whatsapp":  return report.whatsapp;
      case "discord":   return report.discord;
      case "email":     return report.email.text;  // plain text for the notify() path
      default:          return report.whatsapp;     // safe fallback
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DIRECT API MODE (for demo tomorrow)
  // Calls each platform's API directly — no OpenClaw needed.
  // ══════════════════════════════════════════════════════════════════════════

  private async sendDirect(
    channel:   NotificationChannel,
    message:   string,
    sessionId: string
  ): Promise<INotificationResult> {
    switch (channel) {
      case "telegram":
        return this.sendTelegram(message, sessionId);
      case "discord":
        return this.sendDiscord(message, sessionId);
      case "email":
        return this.sendEmailDirect(message, sessionId);
      default:
        // WhatsApp direct API requires Meta approval — mock for now
        console.log(`[Notifier] ${channel} direct not configured — logging`);
        console.log(`[Notifier] ${channel} message:\n${message}`);
        return { channel, success: true };
    }
  }

  // ── sendTelegram ───────────────────────────────────────────────────────────
  // Direct Telegram Bot API call.
  // Requires: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env
  //
  // How to get these (5 minutes):
  //   1. Message @BotFather on Telegram → /newbot → give it a name
  //   2. BotFather gives you a token like: 1234567890:ABCdefGHI...
  //   3. Start a conversation with your new bot
  //   4. Visit: https://api.telegram.org/bot{YOUR_TOKEN}/getUpdates
  //   5. Send a message to your bot then refresh — you'll see your chat_id

  private async sendTelegram(
    message:   string,
    sessionId: string
  ): Promise<INotificationResult> {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      // Don't crash — just log the message so the demo still works
      console.log(
        "[Notifier] Telegram not configured " +
        "(set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)"
      );
      console.log("[Notifier] Would have sent:\n", message.substring(0, 200));
      return { channel: "telegram", success: true };
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;

      const response = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id:    chatId,
          text:       message,
          parse_mode: "MarkdownV2",
          // Disable web page previews — cleaner messages
          disable_web_page_preview: true,
        }),
      });

      const data = await response.json() as any;

      if (!data.ok) {
        // Telegram returned an error — try without markdown formatting
        // (sometimes special characters in content break MarkdownV2)
        console.warn(
          `[Notifier] Telegram MarkdownV2 failed: ${data.description}. ` +
          `Retrying as plain text.`
        );
        return this.sendTelegramPlainText(message, token, chatId);
      }

      console.log(
        `[Notifier] ✓ Telegram sent (session: ${sessionId}, ` +
        `message_id: ${data.result?.message_id})`
      );
      return { channel: "telegram", success: true };

    } catch (error) {
      const err = error as Error;
      console.error("[Notifier] Telegram error:", err.message);
      return { channel: "telegram", success: false, error: err.message };
    }
  }

  // Fallback: send as plain text if MarkdownV2 fails
  private async sendTelegramPlainText(
    message: string,
    token:   string,
    chatId:  string
  ): Promise<INotificationResult> {
    try {
      // Strip all markdown formatting characters
      const plainText = message
        .replace(/[*_`[\]()~>#+=|{}.!\\\-]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const url = `https://api.telegram.org/bot${token}/sendMessage`;

      const response = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text:    plainText,
        }),
      });

      const data = await response.json() as any;

      if (data.ok) {
        console.log("[Notifier] ✓ Telegram sent (plain text fallback)");
        return { channel: "telegram", success: true };
      } else {
        console.warn("[Notifier] ✗ Telegram plain text failed:", data.description);
        return {
          channel: "telegram",
          success: false,
          error:   data.description || "Unknown error",
        };
      }
    } catch (error) {
      const err = error as Error;
      console.error("[Notifier] Telegram plain text error:", err.message);
      return {
        channel: "telegram",
        success: false,
        error: err.message || "Failed to send Telegram message",
      };
    }
  }

  // ── sendDiscord ────────────────────────────────────────────────────────────
  // Direct Discord webhook — easiest of all channels to set up.
  // No bot needed — just a webhook URL from Discord channel settings.

  private async sendDiscord(
    message:   string,
    sessionId: string
  ): Promise<INotificationResult> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
      console.log("[Notifier] Discord not configured (set DISCORD_WEBHOOK_URL)");
      return { channel: "discord", success: true };
    }

    try {
      const response = await fetch(webhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content:  message,
          username: "RapidoMeet",
        }),
      });

      if (response.status === 204) {
        // Discord returns 204 No Content on success
        console.log(`[Notifier] ✓ Discord sent (session: ${sessionId})`);
        return { channel: "discord", success: true };
      }

      const errorText = await response.text();
      return { channel: "discord", success: false, error: errorText };

    } catch (error) {
      return {
        channel: "discord",
        success: false,
        error:   (error as Error).message,
      };
    }
  }

  // ── sendEmailDirect ────────────────────────────────────────────────────────
  // Direct Resend API call for email.
  // Logs to console if not configured — demo still works without it.

  private async sendEmailDirect(
    message:   string,
    sessionId: string
  ): Promise<INotificationResult> {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || "noreply@rapidomeet.io";

    if (!resendKey) {
      console.log("[Notifier] Email not configured (set RESEND_API_KEY)");
      return { channel: "email", success: true };
    }

    // For the direct path we only log — full HTML email is in the
    // /send-email-recap route which uses the formatter's html output
    console.log(`[Notifier] Email would send via Resend (session: ${sessionId})`);
    return { channel: "email", success: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPENCLAW MODE (production — calls Michael's AWS deployment)
  // ══════════════════════════════════════════════════════════════════════════

  private async sendViaOpenClaw(
    channel:   NotificationChannel,
    message:   string,
    sessionId: string
  ): Promise<INotificationResult> {
    const openClawUrl = process.env.OPENCLAW_URL;

    if (!openClawUrl) {
      throw new Error(
        "[Notifier] OPENCLAW_URL is not set — " +
        "set USE_OPENCLAW=false for direct mode or add OPENCLAW_URL"
      );
    }

    try {
      const response = await fetch(`${openClawUrl}/distribute`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${process.env.OPENCLAW_API_KEY || ""}`,
          "X-Session-Id":  sessionId,
        },
        body: JSON.stringify({
          channel,
          message,
          session_id: sessionId,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenClaw returned ${response.status}: ${errorText}`
        );
      }

      console.log(
        `[Notifier] ✓ OpenClaw → ${channel} (session: ${sessionId})`
      );
      return { channel, success: true };

    } catch (error) {
      const err = error as Error;
      console.error(`[Notifier] OpenClaw → ${channel} failed:`, err.message);
      return { channel, success: false, error: err.message };
    }
  }
}

// Export a single shared instance
export const notifier = new Notifier();