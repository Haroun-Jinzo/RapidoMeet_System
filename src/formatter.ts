// src/formatter.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: Report Formatter
// Interface:  IReportFormatter (from interfaces.ts)
// Responsibility: Build formatted message strings for all output channels.
//                 Pure function — no network calls, no database, no AI.
// Dependencies: None — only interfaces.ts types.
// ─────────────────────────────────────────────────────────────────────────────

import {
  IReportFormatter,
  IFormattedReport,
  ISessionContext,
  IDispatchResult,
} from "./interfaces";

class ReportFormatter implements IReportFormatter {

  // ── format ─────────────────────────────────────────────────────────────────
  // Main entry point. Builds all 4 channel formats at once.
  // Called once per completed session.

  format(
    session: ISessionContext,
    results: IDispatchResult[]
  ): IFormattedReport {
    if (!session.extraction) {
      throw new Error(
        "[Formatter] Session has no extraction — " +
        "call extract.ts before formatter.ts"
      );
    }

    return {
      telegram: this.formatTelegram(session, results),
      whatsapp: this.formatWhatsApp(session, results),
      discord:  this.formatDiscord(session, results),
      email:    this.formatEmail(session, results),
    };
  }

  // ── TELEGRAM format ────────────────────────────────────────────────────────
  // Telegram MarkdownV2 has strict escaping rules.
  // These characters MUST be escaped with a backslash:
  // _ * [ ] ( ) ~ ` > # + - = | { } . !
  //
  // We escape the user content but use the special characters
  // intentionally for formatting (bold, italic, code).

  private formatTelegram(
    session: ISessionContext,
    results: IDispatchResult[]
  ): string {
    const e = this.escapeTelegram.bind(this);
    const x = session.extraction!;
    const successCount = results.filter(r => r.success).length;

    const lines: string[] = [];

    // Header
    lines.push(`📋 *${e(session.meetingTitle)}*`);
    lines.push(`_${e(new Date(session.startedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }))}  ·  ${e(session.meetingType)}_`);
    lines.push("");

    // Summary
    lines.push(`💬 ${e(x.summary)}`);
    lines.push("");

    // Sentiment badge
    const sentimentEmoji =
      x.sentiment === "positive" ? "🟢" :
      x.sentiment === "negative" ? "🔴" : "🟡";
    lines.push(`${sentimentEmoji} Sentiment : *${e(x.sentiment)}*`);
    lines.push("");

    // Tasks
    if (x.tasks.length > 0) {
      lines.push(`✅ *Tâches \\(${x.tasks.length}\\)*`);
      x.tasks.forEach(task => {
        const deadline = task.deadline ? ` · ${e(task.deadline)}` : "";
        const assignee = task.assignee ? ` → _${e(task.assignee)}_` : "";
        const emoji =
          task.priority === "high"   ? "🔴" :
          task.priority === "medium" ? "🟡" : "⚪";
        lines.push(`${emoji} ${e(task.title)}${assignee}${deadline}`);
      });
      lines.push("");
    }

    // Decisions
    if (x.decisions.length > 0) {
      lines.push(`🏛 *Décisions \\(${x.decisions.length}\\)*`);
      x.decisions.forEach(d => {
        lines.push(`• ${e(d.text)}`);
      });
      lines.push("");
    }

    // Prospects
    if (x.prospects.length > 0) {
      lines.push(`🎯 *Prospects \\(${x.prospects.length}\\)*`);
      x.prospects.forEach(p => {
        const score =
          p.score === "hot"  ? "🔥 Chaud" :
          p.score === "warm" ? "☀️ Tiède" : "🧊 Froid";
        lines.push(`*${e(p.company)}* ${p.contact ? `· ${e(p.contact)}` : ""} · ${score}`);
        if (p.interest) lines.push(`  ↳ ${e(p.interest)}`);
      });
      lines.push("");
    }

    // Actions executed
    lines.push(`⚡ *Actions exécutées : ${successCount}/${results.length}*`);
    if (session.actions) {
      session.actions
        .filter(a => a.status === "executed")
        .forEach(a => {
          const toolLabel = a.tool.replace(".", " → ");
          lines.push(`✓ \`${e(toolLabel)}\``);
        });
    }

    // Footer
    lines.push("");
    lines.push(`_Traité par RapidoMeet · Skill : ${e(x.skillUsed)}_`);

    return lines.join("\n");
  }

  // ── WHATSAPP format ────────────────────────────────────────────────────────
  // WhatsApp supports minimal formatting: *bold*, _italic_, ~strikethrough~
  // No markdown tables, no code blocks, no nested formatting.
  // Keep it short — WhatsApp messages work best under 300 words.

  private formatWhatsApp(
    session: ISessionContext,
    results: IDispatchResult[]
  ): string {
    const x = session.extraction!;
    const successCount = results.filter(r => r.success).length;

    const lines: string[] = [];

    lines.push(`📋 *${session.meetingTitle}*`);
    lines.push(`${new Date(session.startedAt).toLocaleDateString("fr-FR")}`);
    lines.push("");
    lines.push(x.summary);
    lines.push("");

    if (x.tasks.length > 0) {
      lines.push(`✅ *${x.tasks.length} tâche(s)*`);
      x.tasks.slice(0, 5).forEach(t => { // max 5 for WhatsApp brevity
        lines.push(`• ${t.title}${t.assignee ? ` (${t.assignee})` : ""}`);
      });
      if (x.tasks.length > 5) {
        lines.push(`• ... et ${x.tasks.length - 5} autres`);
      }
      lines.push("");
    }

    if (x.prospects.length > 0) {
      lines.push(`🎯 *${x.prospects.length} prospect(s)*`);
      x.prospects.forEach(p => {
        const score = p.score === "hot" ? "🔥" : p.score === "warm" ? "☀️" : "🧊";
        lines.push(`${score} ${p.company}${p.contact ? ` · ${p.contact}` : ""}`);
      });
      lines.push("");
    }

    lines.push(`⚡ ${successCount} action(s) exécutée(s) automatiquement`);
    lines.push(`_RapidoMeet · ${x.skillUsed}_`);

    return lines.join("\n");
  }

  // ── DISCORD format ─────────────────────────────────────────────────────────
  // Discord supports markdown similar to Telegram but simpler escaping.
  // Supports embeds but we keep it as plain markdown for simplicity.

  private formatDiscord(
    session: ISessionContext,
    results: IDispatchResult[]
  ): string {
    const x = session.extraction!;
    const successCount = results.filter(r => r.success).length;
    const date = new Date(session.startedAt)
      .toLocaleDateString("fr-FR");

    const lines: string[] = [];

    lines.push(`## 📋 ${session.meetingTitle}`);
    lines.push(`**${date}** · Skill: \`${x.skillUsed}\``);
    lines.push("");
    lines.push(`> ${x.summary}`);
    lines.push("");

    if (x.tasks.length > 0) {
      lines.push(`### ✅ Tâches (${x.tasks.length})`);
      x.tasks.forEach(t => {
        const priority = t.priority === "high" ? "🔴" :
                         t.priority === "medium" ? "🟡" : "⚪";
        lines.push(`${priority} **${t.title}**${t.assignee ? ` — ${t.assignee}` : ""}${t.deadline ? ` · ${t.deadline}` : ""}`);
      });
      lines.push("");
    }

    if (x.decisions.length > 0) {
      lines.push(`### 🏛 Décisions (${x.decisions.length})`);
      x.decisions.forEach(d => {
        lines.push(`- ${d.text}`);
      });
      lines.push("");
    }

    if (x.prospects.length > 0) {
      lines.push(`### 🎯 Prospects (${x.prospects.length})`);
      x.prospects.forEach(p => {
        const score = p.score === "hot" ? "🔥" : p.score === "warm" ? "☀️" : "🧊";
        lines.push(`${score} **${p.company}**${p.contact ? ` · ${p.contact}` : ""}`);
      });
      lines.push("");
    }

    lines.push(`⚡ **${successCount}/${results.length}** actions exécutées`);

    return lines.join("\n");
  }

  // ── EMAIL format ───────────────────────────────────────────────────────────
  // Full HTML email with inline CSS (required for email clients).
  // Uses RapidoMeet green (#1A9E3F) as accent colour.
  // Also provides a plain text fallback.

  private formatEmail(
    session: ISessionContext,
    results: IDispatchResult[]
  ): { subject: string; html: string; text: string } {
    const x = session.extraction!;
    const date = new Date(session.startedAt)
      .toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const successCount = results.filter(r => r.success).length;

    const subject = `📋 Compte-rendu : ${session.meetingTitle} — ${date}`;

    // ── HTML ──────────────────────────────────────────────────────────────
    const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1A9E3F;padding:28px 32px;">
            <h1 style="margin:0;color:#FFFFFF;font-size:20px;font-weight:bold;">
              RapidoMeet
            </h1>
            <p style="margin:6px 0 0;color:#C3E6CC;font-size:14px;">
              Compte-rendu automatique
            </p>
          </td>
        </tr>

        <!-- Meeting title -->
        <tr>
          <td style="padding:28px 32px 16px;">
            <h2 style="margin:0 0 6px;color:#1A2332;font-size:22px;">
              ${this.escapeHtml(session.meetingTitle)}
            </h2>
            <p style="margin:0;color:#64748B;font-size:14px;">
              ${date} &nbsp;·&nbsp; Skill : ${this.escapeHtml(x.skillUsed)}
              &nbsp;·&nbsp;
              <span style="color:${x.sentiment === "positive" ? "#16A34A" : x.sentiment === "negative" ? "#DC2626" : "#D97706"}">
                ${x.sentiment === "positive" ? "😊 Positif" : x.sentiment === "negative" ? "😟 Négatif" : "😐 Neutre"}
              </span>
            </p>
          </td>
        </tr>

        <!-- Summary -->
        <tr>
          <td style="padding:0 32px 24px;">
            <div style="background:#F4F6F8;border-left:4px solid #1A9E3F;padding:16px;border-radius:0 8px 8px 0;">
              <p style="margin:0;color:#1A2332;font-size:15px;line-height:1.6;">
                ${this.escapeHtml(x.summary)}
              </p>
            </div>
          </td>
        </tr>

        ${x.tasks.length > 0 ? `
        <!-- Tasks -->
        <tr>
          <td style="padding:0 32px 24px;">
            <h3 style="margin:0 0 14px;color:#1A2332;font-size:16px;border-bottom:2px solid #E2E8F0;padding-bottom:8px;">
              ✅ Tâches (${x.tasks.length})
            </h3>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${x.tasks.map(t => `
              <tr>
                <td style="padding:10px;background:${t.priority === "high" ? "#FEE2E2" : t.priority === "medium" ? "#FEF9C3" : "#F1F5F9"};border-radius:8px;margin-bottom:8px;display:block;">
                  <strong style="color:#1A2332;font-size:14px;">${this.escapeHtml(t.title)}</strong>
                  <br>
                  <span style="color:#64748B;font-size:12px;">
                    ${t.assignee ? `👤 ${this.escapeHtml(t.assignee)}` : ""}
                    ${t.deadline ? `&nbsp;·&nbsp; 📅 ${this.escapeHtml(t.deadline)}` : ""}
                  </span>
                </td>
              </tr>
              <tr><td style="height:6px;"></td></tr>
              `).join("")}
            </table>
          </td>
        </tr>
        ` : ""}

        ${x.prospects.length > 0 ? `
        <!-- Prospects -->
        <tr>
          <td style="padding:0 32px 24px;">
            <h3 style="margin:0 0 14px;color:#1A2332;font-size:16px;border-bottom:2px solid #E2E8F0;padding-bottom:8px;">
              🎯 Prospects (${x.prospects.length})
            </h3>
            ${x.prospects.map(p => `
            <div style="border:1px solid #C3E6CC;border-radius:8px;padding:14px;margin-bottom:10px;background:#E8F5EE;">
              <strong style="color:#166534;font-size:15px;">${this.escapeHtml(p.company)}</strong>
              ${p.contact ? `<span style="color:#64748B;font-size:13px;"> · ${this.escapeHtml(p.contact)}</span>` : ""}
              <span style="float:right;background:${p.score === "hot" ? "#DC2626" : p.score === "warm" ? "#D97706" : "#64748B"};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:bold;">
                ${p.score === "hot" ? "🔥 Chaud" : p.score === "warm" ? "☀️ Tiède" : "🧊 Froid"}
              </span>
              ${p.interest ? `<p style="margin:8px 0 0;color:#1A2332;font-size:13px;">💡 ${this.escapeHtml(p.interest)}</p>` : ""}
              ${p.nextStep ? `<p style="margin:6px 0 0;color:#1A9E3F;font-size:13px;">→ ${this.escapeHtml(p.nextStep)}</p>` : ""}
            </div>
            `).join("")}
          </td>
        </tr>
        ` : ""}

        ${x.decisions.length > 0 ? `
        <!-- Decisions -->
        <tr>
          <td style="padding:0 32px 24px;">
            <h3 style="margin:0 0 14px;color:#1A2332;font-size:16px;border-bottom:2px solid #E2E8F0;padding-bottom:8px;">
              🏛 Décisions (${x.decisions.length})
            </h3>
            ${x.decisions.map(d => `
            <div style="padding:10px 14px;background:#F1F5F9;border-radius:8px;margin-bottom:8px;">
              <p style="margin:0;color:#1A2332;font-size:14px;">
                ✓ ${this.escapeHtml(d.text)}
                ${d.owner ? `<span style="color:#64748B;font-size:12px;"> — ${this.escapeHtml(d.owner)}</span>` : ""}
              </p>
            </div>
            `).join("")}
          </td>
        </tr>
        ` : ""}

        <!-- Actions executed -->
        <tr>
          <td style="padding:0 32px 24px;">
            <div style="background:#E8F5EE;border-radius:8px;padding:14px;">
              <p style="margin:0;color:#166534;font-size:14px;font-weight:bold;">
                ⚡ ${successCount} action(s) exécutée(s) automatiquement
              </p>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F4F6F8;padding:20px 32px;border-top:1px solid #E2E8F0;">
            <p style="margin:0;color:#94A3B8;font-size:12px;text-align:center;">
              Généré par <strong>RapidoMeet</strong> · BraindCode ·
              <a href="https://rapidomeet.io" style="color:#1A9E3F;text-decoration:none;">rapidomeet.io</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

    // ── Plain text fallback ───────────────────────────────────────────────
    const text = [
      `COMPTE-RENDU : ${session.meetingTitle}`,
      `Date : ${date}`,
      `Skill : ${x.skillUsed}`,
      "",
      x.summary,
      "",
      x.tasks.length > 0 ? [
        `TÂCHES (${x.tasks.length})`,
        ...x.tasks.map(t =>
          `- ${t.title}${t.assignee ? ` (${t.assignee})` : ""}${t.deadline ? ` · ${t.deadline}` : ""}`
        ),
        "",
      ].join("\n") : "",
      x.prospects.length > 0 ? [
        `PROSPECTS (${x.prospects.length})`,
        ...x.prospects.map(p =>
          `- ${p.company}${p.contact ? ` · ${p.contact}` : ""} · ${p.score.toUpperCase()}`
        ),
        "",
      ].join("\n") : "",
      x.decisions.length > 0 ? [
        `DÉCISIONS (${x.decisions.length})`,
        ...x.decisions.map(d => `- ${d.text}`),
        "",
      ].join("\n") : "",
      `${successCount} action(s) exécutée(s) automatiquement.`,
      "",
      "-- RapidoMeet · BraindCode",
    ].filter(Boolean).join("\n");

    return { subject, html, text };
  }

  // ── PRIVATE helpers ────────────────────────────────────────────────────────

  // Escape special characters for Telegram MarkdownV2
  private escapeTelegram(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\-]/g, "\\$&");
  }

  // Escape HTML entities for email
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g,  "&amp;")
      .replace(/</g,  "&lt;")
      .replace(/>/g,  "&gt;")
      .replace(/"/g,  "&quot;")
      .replace(/'/g,  "&#039;");
  }
}

// Export a single shared instance
export const reportFormatter = new ReportFormatter();