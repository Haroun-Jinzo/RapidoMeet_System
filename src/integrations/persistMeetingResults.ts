import { createClient } from "@supabase/supabase-js";
import { ISessionContext } from "../interfaces";
import { INLPOutput } from "../interfaces/INLPOutput";
import { ISpeakerSegment } from "../interfaces/ISpeakerSegment";
import { IAction } from "../interfaces";
import { formatPendingAction } from "../utils/pendingActionFormatter";
import { safeMeetingPatch } from "./safeMeetingPatch";
import { memoryManager } from "../memory";

const supabaseService = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type PersistMeetingStatus = "analyzing" | "completed";

export async function persistMeetingCancellation(session: ISessionContext): Promise<void> {
  const meetingId = await resolveMeetingId(session);
  if (!meetingId) return;

  await safeMeetingPatch(supabaseService, meetingId, session.userId, {
    error_message: "Traitement annulé par l'utilisateur",
    updated_at: new Date().toISOString(),
  });
}

function sentimentToScore(sentiment?: string): number {
  switch (sentiment) {
    case "positive":
      return 75;
    case "negative":
      return 25;
    default:
      return 50;
  }
}

function formatSegmentTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function mapSegmentsForDb(segments?: ISpeakerSegment[]): Array<Record<string, unknown>> {
  if (!segments?.length) return [];
  return segments.map((seg) => ({
    speaker: seg.speaker || "Speaker 0",
    text: seg.text,
    timestamp: formatSegmentTime(seg.start ?? 0),
    start: seg.start,
    end: seg.end,
  }));
}

async function resolveMeetingId(session: ISessionContext): Promise<string | null> {
  if (session.meetingId) return session.meetingId;

  const { data } = await supabaseService
    .from("meetings")
    .select("id")
    .eq("session_id", session.id)
    .maybeSingle();

  return data?.id ?? null;
}

async function tableHasRows(table: string, meetingId: string): Promise<boolean> {
  const { count } = await supabaseService
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("meeting_id", meetingId);

  return (count ?? 0) > 0;
}

import { PendingActionStatus } from "../interfaces/IPendingAction";

function actionToInsertStatus(action: IAction): PendingActionStatus {
  if (action.status === "executed") return "executed";
  if (action.status === "confirmed") return "approved";
  if (action.status === "refused" || action.status === "timeout") return "refused";
  if (action.execution_status === "failed") return "failed";
  return "pending";
}

async function syncConfirmationActions(
  session: ISessionContext,
  meetingId: string
): Promise<void> {
  const critical = session.actions?.filter((a) => a.requiresConfirmation) ?? [];
  if (critical.length === 0) return;

  for (const action of critical) {
    const formatted = formatPendingAction(action);

    try {
      await memoryManager.savePendingAction(
        {
          actionId: action.id,
          sessionId: session.id,
          userId: session.userId,
          actionTool: action.tool,
          params: action.params ?? {},
          status: actionToInsertStatus(action),
        },
        {
          meetingId,
          display: {
            title: formatted.title,
            summary: formatted.summary,
            destination: formatted.destination,
            action_type: formatted.action_type,
          },
        }
      );
    } catch (err) {
      console.warn(`[Persist] pending_actions sync ${action.id}:`, (err as Error).message);
    }
  }
}

/**
 * Writes pipeline output into RapidoMeet Supabase tables used by ReunionDetail tabs.
 */
export async function persistMeetingResults(
  session: ISessionContext,
  options?: { meetingStatus?: PersistMeetingStatus }
): Promise<string | null> {
  const meetingId = await resolveMeetingId(session);
  if (!meetingId) {
    console.warn(
      `[Persist] No meetingId for session ${session.id} — link meeting_id on upload or set session_id on meetings row`
    );
    return null;
  }

  const extraction = (session.extraction ?? {}) as INLPOutput & Record<string, unknown>;
  const meetingStatus =
    options?.meetingStatus ??
    (session.status === "complete" ? "completed" : "analyzing");

  const summary =
    (typeof extraction.summary === "string" && extraction.summary) ||
    (typeof extraction.executive_summary === "string" && extraction.executive_summary) ||
    null;

  const sentimentScore =
    typeof extraction.sentiment_score === "number"
      ? extraction.sentiment_score
      : sentimentToScore(extraction.sentiment as string | undefined);

  const precisionPercent =
    typeof extraction.precision_percent === "number"
      ? extraction.precision_percent
      : null;

  // Legacy fallback — never abort child-table writes when meetings patch fails
  const meetingPatch = await safeMeetingPatch(supabaseService, meetingId, session.userId, {
    status: meetingStatus,
    session_id: session.id,
    summary,
    sentiment_score: sentimentScore,
    precision_percent: precisionPercent,
    duration_seconds: session.durationSeconds ?? null,
    completed_at: meetingStatus === "completed" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
    // Older openclaw-style meetings rows (if present on remote DB)
    transcript: session.transcript ?? null,
    extraction: extraction as Record<string, unknown>,
    actions: session.actions ?? [],
    duration: session.durationSeconds ?? null,
  });

  if (!meetingPatch.ok) {
    console.warn(
      `[Persist] meetings update failed (child tables will still sync): ${meetingPatch.error}`
    );
  }

  const transcript = session.transcript?.trim();
  if (transcript) {
    const segments = mapSegmentsForDb(session.transcriptionSegments);
    const { data: existing } = await supabaseService
      .from("transcriptions")
      .select("id")
      .eq("meeting_id", meetingId)
      .maybeSingle();

    const row = {
      meeting_id: meetingId,
      user_id: session.userId,
      full_text: transcript,
      segments,
      word_count: transcript.split(/\s+/).filter(Boolean).length,
      language: "fr",
    };

    if (existing?.id) {
      await supabaseService.from("transcriptions").update(row).eq("id", existing.id);
    } else {
      await supabaseService.from("transcriptions").insert(row);
    }
  }

  const tasks = Array.isArray(extraction.tasks) ? extraction.tasks : [];
  if (tasks.length > 0 && !(await tableHasRows("extracted_tasks", meetingId))) {
    const { error } = await supabaseService.from("extracted_tasks").insert(
      tasks
        .filter((t) => typeof t.title === "string" && t.title.trim())
        .map((t) => ({
          meeting_id: meetingId,
          user_id: session.userId,
          title: t.title,
          assignee: t.assignee || null,
          deadline: t.deadline || null,
          priority: t.priority || "medium",
          status: "pending",
          source_timestamp: (t as { source_timestamp?: string }).source_timestamp || t.source || null,
        }))
    );
    if (error) {
      console.warn("[Persist] extracted_tasks insert failed:", error.message);
    }
  }

  const decisions = Array.isArray(extraction.decisions) ? extraction.decisions : [];
  if (decisions.length > 0 && !(await tableHasRows("extracted_decisions", meetingId))) {
    const { error } = await supabaseService.from("extracted_decisions").insert(
      decisions
        .map((d) => {
          const content =
            (d as { content?: string }).content ||
            (d as { text?: string }).text ||
            "";
          return content.trim();
        })
        .filter(Boolean)
        .map((content) => ({
          meeting_id: meetingId,
          user_id: session.userId,
          content,
          source_timestamp: null,
        }))
    );
    if (error) {
      console.warn("[Persist] extracted_decisions insert failed:", error.message);
    }
  }

  const prospects = Array.isArray(extraction.prospects) ? extraction.prospects : [];
  const legacyContacts = Array.isArray((extraction as Record<string, unknown>).contacts)
    ? ((extraction as Record<string, unknown>).contacts as Array<Record<string, unknown>>)
    : [];

  const contacts = prospects.length > 0
    ? prospects.map((p) => ({
        name: p.contact || p.company,
        company: p.company || null,
        email: p.email || null,
        score: typeof p.score === "number" ? p.score : p.score === "hot" ? 85 : p.score === "warm" ? 60 : 35,
        interest_signals: p.interest || p.nextStep || null,
      }))
    : legacyContacts;

  if (contacts.length > 0 && !(await tableHasRows("detected_contacts", meetingId))) {
    const { error } = await supabaseService.from("detected_contacts").insert(
      contacts
        .filter((c) => typeof c.name === "string" && c.name.trim())
        .map((c) => ({
          meeting_id: meetingId,
          user_id: session.userId,
          name: c.name as string,
          company: (c.company as string) || null,
          email: (c.email as string) || null,
          score: typeof c.score === "number" ? c.score : 0,
          interest_signals: (c.interest_signals as string) || null,
        }))
    );
    if (error) {
      console.warn("[Persist] detected_contacts insert failed:", error.message);
    }
  }

  await syncConfirmationActions(session, meetingId);

  if (summary && !(await tableHasRows("reports", meetingId))) {
    const reportJson = {
      summary,
      sentiment_score: sentimentScore,
      tasks_count: tasks.length,
      decisions_count: decisions.length,
      contacts_count: contacts.length,
      generated_at: new Date().toISOString(),
    };

    const { error } = await supabaseService.from("reports").insert({
      meeting_id: meetingId,
      user_id: session.userId,
      title: session.meetingTitle || "Meeting report",
      report_type: "meeting_summary",
      content_json: reportJson,
      content_html: null,
    });

    if (error) {
      console.warn("[Persist] reports insert failed:", error.message);
    }
  }

  console.log(
    `[Persist] Meeting ${meetingId} synced (status=${meetingStatus}, transcript=${!!transcript}, tasks=${tasks.length})`
  );

  return meetingId;
}
