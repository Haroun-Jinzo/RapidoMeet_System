import { Router, Request, Response } from "express";
import { sessionManager } from "../session";
import { streamSessionProgress } from "../progress/sse";
import { progressBus } from "../progress/ProgressBus";
import { memoryManager } from "../memory";
import { mcpDispatcher } from "../dispatcher";
import { KeyResolver } from "../utils/KeyResolver";
import { openclawClient } from "../openclaw/OpenClawClient";
import { isCrmTool } from "../config/crmTools";
import { isCmsTool } from "../config/cmsTools";
import { isRhTool } from "../config/rhTools";
import { formatPendingAction, formatConfirmationAction } from "../utils/pendingActionFormatter";
import { IAction, ISessionContext } from "../interfaces";
import {
  persistMeetingCancellation,
  persistMeetingResults,
} from "../integrations/persistMeetingResults";
import { requestPipelineCancellation } from "../pipeline/cancellation";

function getPendingCriticalActions(actions: IAction[] | undefined): IAction[] {
  return actions?.filter((a) => a.requiresConfirmation && a.status === "pending") ?? [];
}

async function syncMeetingToSupabase(
  session: ISessionContext,
  meetingStatus: "analyzing" | "completed"
): Promise<void> {
  try {
    await persistMeetingResults(session, { meetingStatus });
  } catch (err) {
    console.warn("[Pipeline] persistMeetingResults failed:", (err as Error).message);
  }
}

async function handleActionDecision(
  req: Request,
  res: Response,
  decision: "confirm" | "refuse"
): Promise<void> {
  const session_id = req.params.id as string;
  const action_id = req.params.actionId as string;
  const session = await sessionManager.load(session_id);

  if (!session) {
    res.status(404).json({ error: "Session not found or expired" });
    return;
  }

  const action = session.actions?.find((a: IAction) => a.id === action_id);
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }

  const countStillPending = () => getPendingCriticalActions(session.actions);

  if (
    decision === "confirm" &&
    (action.status === "executed" ||
      (action.status === "confirmed" && action.execution_status === "success"))
  ) {
    console.log(`[Gate] Action ${action_id} already executed — skipping duplicate confirm`);
    const stillPending = countStillPending();
    if (stillPending.length === 0) {
      session.status = "complete";
    }
    await sessionManager.save(session);
    res.json({
      action_id,
      decision: action.status,
      already_done: true,
      still_pending: stillPending.length,
    });
    return;
  }

  if (decision === "confirm" && action.status === "refused") {
    res.status(409).json({ error: "Action was already refused" });
    return;
  }

  action.status = decision === "confirm" ? "confirmed" : "refused";
  console.log(`[Gate] Action ${action_id} ${action.status.toUpperCase()}`);

  try {
    await memoryManager.updatePendingActionStatus(
      action_id,
      decision === "confirm" ? "approved" : "refused"
    );
  } catch (err) {
    console.warn(`[Gate] pending_actions update failed for ${action_id}:`, (err as Error).message);
  }

  const runsOnConfirm =
    decision === "confirm" &&
    (isCrmTool(action.tool) ||
      isCmsTool(action.tool) ||
      isRhTool(action.tool) ||
      action.tool === "calendar_create_event");

  if (runsOnConfirm) {
    try {
      const apiKeys = await KeyResolver.resolveKeys(session.userId);
      const execResult = await mcpDispatcher.execute(action, apiKeys);
      if (execResult.success) {
        action.status = "executed";
        action.execution_status = "success";
        action.updated_at = new Date().toISOString();
        const channel =
          action.tool === "calendar_create_event"
            ? "Google Calendar API"
            : isCmsTool(action.tool)
              ? "RapidoCMS MCP"
              : isRhTool(action.tool)
                ? "Rapido RH MCP"
                : "RapidoCRM MCP";
        console.log(`[Gate] Action ${action_id} executed via ${channel}`);
        progressBus.emit({
          sessionId: session_id,
          step: "action",
          message: `Completed: ${action.tool.replace(/_/g, " ")}`,
          progress: 98,
          detail: `Executed after approval via ${channel}`,
        });
      } else {
        action.execution_status = "failed";
        action.status = "pending";
        console.error(`[Gate] Action ${action_id} failed:`, execResult.error);
        progressBus.emit({
          sessionId: session_id,
          step: "error",
          message: `Failed: ${action.tool.replace(/_/g, " ")}`,
          progress: 98,
          error: execResult.error,
        });
      }
    } catch (err) {
      action.execution_status = "failed";
      action.status = "pending";
      console.error(`[Gate] Execution error for ${action_id}:`, (err as Error).message);
    }
  }

  const stillPending = countStillPending();

  if (stillPending.length === 0) {
    session.status = "complete";
    await syncMeetingToSupabase(session, "completed");
    progressBus.emit({
      sessionId: session_id,
      step: "complete",
      state: "complete",
      message: "All actions approved — meeting processing complete",
      progress: 100,
    });
  } else {
    session.status = "awaiting_confirmation";
    progressBus.emit({
      sessionId: session_id,
      step: "confirmation",
      state: "awaiting_confirmation",
      message: `${stillPending.length} action${stillPending.length === 1 ? "" : "s"} still waiting for your approval`,
      progress: 95,
      detail: stillPending.map((a) => a.tool).join(", "),
      pending_actions: stillPending.map(formatPendingAction),
    });
  }

  await sessionManager.save(session);

  const wsType = decision === "confirm" ? "meeting.action_confirmed" : "meeting.action_refused";
  try {
    await openclawClient.sendReport(wsType as "meeting.action_confirmed" | "meeting.action_refused", {
      session_id,
      user_id: session.userId,
      action_id,
      decision,
      still_pending: stillPending.length,
    });
  } catch (e) {
    console.error("OpenClaw WS emit failed:", e);
  }

  res.json({
    action_id,
    decision: action.status,
    still_pending: stillPending.length,
    pending_actions: stillPending.map(formatPendingAction),
    confirmation_actions: (session.actions ?? [])
      .filter((a) => a.requiresConfirmation)
      .map(formatConfirmationAction),
    session_status: session.status,
  });
}

export function createSessionsRouter(authMiddleware: any): Router {
  const router = Router();

  router.get("/sessions/:id/progress", authMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.params.id as string;
    const user = (req as Request & { user: { id: string } }).user;
    const session = await sessionManager.load(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    if (session.userId !== user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    streamSessionProgress(req, res, sessionId);
  });

  router.post(
    "/sessions/:id/cancel",
    authMiddleware,
    async (req: Request, res: Response) => {
      const sessionId = req.params.id as string;
      const user = (req as Request & { user: { id: string } }).user;
      const session = await sessionManager.load(sessionId);

      if (!session) {
        return res.status(404).json({ error: "Session not found or expired" });
      }
      if (session.userId !== user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (session.status === "complete" || session.status === "error") {
        return res.status(409).json({ error: `Session is already ${session.status}` });
      }
      if (session.status === "cancelled") {
        return res.json({ session_id: sessionId, status: "cancelled" });
      }

      if (session.status === "processing") {
        requestPipelineCancellation(sessionId);
      }
      session.status = "cancelled";
      await sessionManager.save(session);
      await persistMeetingCancellation(session);
      progressBus.emit({
        sessionId,
        step: "cancelled",
        state: "cancelled",
        message: "Meeting processing cancelled by user",
        progress: 0,
      });

      return res.json({ session_id: sessionId, status: "cancelled" });
    },
  );

  router.post(
    "/sessions/:id/actions/:actionId/confirm",
    authMiddleware,
    async (req: Request, res: Response) => {
      await handleActionDecision(req, res, "confirm");
    }
  );

  router.post(
    "/sessions/:id/actions/:actionId/refuse",
    authMiddleware,
    async (req: Request, res: Response) => {
      await handleActionDecision(req, res, "refuse");
    }
  );

  router.get("/session/:id", authMiddleware, async (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const session = await sessionManager.load(sessionId);

    if (!session) {
      return res.status(404).json({
        error: `Session ${sessionId} not found or expired`,
      });
    }

    const pendingCritical = getPendingCriticalActions(session.actions);
    const confirmationActions = (session.actions ?? [])
      .filter((a) => a.requiresConfirmation)
      .map(formatConfirmationAction);

    return res.json({
      ...session,
      meeting_id: session.meetingId ?? null,
      pending_actions: pendingCritical.map(formatPendingAction),
      confirmation_actions: confirmationActions,
    });
  });

  return router;
}

export { getPendingCriticalActions, syncMeetingToSupabase };
