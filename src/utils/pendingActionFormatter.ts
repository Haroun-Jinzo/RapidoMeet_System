import { IAction } from "../interfaces";

export interface PendingActionSummary {
  id: string;
  title: string;
  summary?: string;
  destination?: string;
  action_type?: string;
}

const TOOL_LABELS: Record<string, string> = {
  calendar_create_event: "Create calendar event",
  crm_create_enterprise: "Create CRM enterprise",
  crm_create_contact: "Create CRM contact",
  crm_update_contact: "Update CRM contact",
  crm_create_contract: "Create CRM contract",
  crm_create_sms_template: "Create SMS template",
  crm_create_email_template: "Create email template",
  crm_create_invoice: "Create invoice",
  crm_create_quote: "Create quote",
  crm_create_deal: "Create CRM deal",
  crm_update_deal: "Update CRM deal",
  crm_create_task: "Create CRM task",
  crm_log_activity: "Log CRM activity",
  send_email: "Send email",
  send_telegram: "Send Telegram message",
};

function pickSummary(params: Record<string, unknown>): string | undefined {
  const candidates = [
    params.title,
    params.subject,
    params.summary,
    params.description,
    params.name,
    params.nom,
    params.company_name,
    params.content,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().length > 160 ? `${value.trim().slice(0, 160)}…` : value.trim();
    }
  }

  return undefined;
}

function pickDestination(params: Record<string, unknown>, tool: string): string | undefined {
  if (tool.includes("calendar")) {
    const start = params.start ?? params.start_time;
    if (typeof start === "string") return start;
  }

  const dest =
    params.to ??
    params.email ??
    params.recipient ??
    params.assignee ??
    params.contact_name;

  return typeof dest === "string" && dest.trim() ? dest.trim() : undefined;
}

export function formatPendingAction(action: IAction): PendingActionSummary {
  const params = action.params ?? {};
  const title = TOOL_LABELS[action.tool] ?? action.tool.replace(/_/g, " ");

  return {
    id: action.id,
    title,
    summary: pickSummary(params as Record<string, unknown>),
    destination: pickDestination(params as Record<string, unknown>, action.tool),
    action_type: action.tool,
  };
}

export function formatConfirmationAction(action: IAction) {
  return {
    ...formatPendingAction(action),
    status: action.status,
    requires_confirmation: action.requiresConfirmation,
    error_message:
      action.execution_status === "failed"
        ? (typeof action.result === "string" ? action.result : null)
        : null,
  };
}
