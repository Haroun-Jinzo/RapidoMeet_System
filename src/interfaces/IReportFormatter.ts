import { ISessionContext } from "./ISessionContext";
import { IDispatchResult } from "./IDispatchResult";
import { IFormattedReport } from "./IFormattedReport";

/**
 * C4 Component: Report Formatter
 * File: src/formatter.ts
 *
 * The ONLY module that builds message strings.
 * Pure function — no network calls, no database access.
 * Input: session + results → Output: formatted strings.
 */
export interface IReportFormatter {
  format(
    session: ISessionContext,
    results: IDispatchResult[]
  ): IFormattedReport;
}

// SECTION 9 — NOTIFIER (notifier.ts)
// Sends formatted reports to all output channels via OpenClaw.

/**
 * Result of one notification attempt on one channel.
 */
