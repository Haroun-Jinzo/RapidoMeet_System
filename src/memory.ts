import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import { IMemoryManager, ITask, IPendingAction, IPendingActionInsert, PendingActionStatus } from "./interfaces";
import {
  fromDbPendingActionStatus,
  toDbPendingActionStatus,
} from "./integrations/pendingActionDb";

class MemoryManager implements IMemoryManager {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    this.supabase = createClient(supabaseUrl, supabaseKey);
    console.log("[Memory] Supabase client initialized");
  }

  async saveTask(task: ITask & { sessionId: string; userId: string }): Promise<string> {
    const id = crypto.randomUUID();
    const { data, error } = await this.supabase
      .from("tasks")
      .insert({
        id, user_id: task.userId, session_id: task.sessionId,
        title: task.title, assignee: task.assignee || null, deadline: task.deadline || null,
        priority: task.priority, source: task.source, done: false, created_at: new Date().toISOString()
      }).select("id").single();

    if (error) throw new Error("[Memory] Task Insert Error: " + error.message);
    return data.id;
  }

  private mapPendingActionRow(data: Record<string, unknown>): IPendingAction {
    const payload = (data.payload && typeof data.payload === "object"
      ? data.payload
      : {}) as Record<string, unknown>;
    const metadata = (data.metadata && typeof data.metadata === "object"
      ? data.metadata
      : {}) as Record<string, unknown>;

    const params = (payload.params && typeof payload.params === "object"
      ? payload.params
      : payload) as Record<string, unknown>;

    return {
      id:          data.id as string | undefined,
      action_id:   (payload.action_id ?? metadata.action_id ?? "") as string,
      session_id:  (payload.session_id ?? metadata.session_id ?? "") as string,
      user_id:     (data.user_id ?? "") as string,
      action_tool: (data.action_type ?? "") as string,
      params,
      status:      fromDbPendingActionStatus(String(data.status ?? "pending")),
      created_at:  data.created_at as string | undefined,
    };
  }

  private buildPendingActionRow(
    action: IPendingActionInsert,
    extra?: { meetingId?: string; display?: Record<string, unknown> }
  ) {
    const payload = {
      action_id:  action.actionId,
      session_id: action.sessionId,
      params:     action.params,
      ...(extra?.display ? { display: extra.display } : {}),
      ...(extra?.meetingId ? { meeting_id: extra.meetingId } : {}),
    };

    return {
      action_type: action.actionTool,
      payload,
      status:      toDbPendingActionStatus(action.status ?? "pending"),
      metadata: {
        action_id:  action.actionId,
        session_id: action.sessionId,
        ...(extra?.meetingId ? { meeting_id: extra.meetingId } : {}),
      },
      user_id: action.userId,
    };
  }

  async savePendingAction(
    action: IPendingActionInsert,
    extra?: { meetingId?: string; display?: Record<string, unknown> }
  ): Promise<void> {
    const row = this.buildPendingActionRow(action, extra);
    const existing = await this.getPendingAction(action.actionId);

    if (existing?.id) {
      const { error } = await this.supabase
        .from("pending_actions")
        .update(row)
        .eq("id", existing.id);

      if (error) {
        throw new Error("[Memory] Pending action update error: " + error.message);
      }
    } else {
      const { error } = await this.supabase
        .from("pending_actions")
        .insert({ id: crypto.randomUUID(), ...row });

      if (error) {
        throw new Error("[Memory] Pending action insert error: " + error.message);
      }
    }

    console.log(`[Memory] Pending action saved: ${action.actionId} (${action.actionTool})`);
  }

  async updatePendingActionStatus(
    actionId: string,
    status: PendingActionStatus
  ): Promise<void> {
    const existing = await this.getPendingAction(actionId);
    if (!existing?.id) {
      throw new Error(`[Memory] Pending action not found for action_id: ${actionId}`);
    }

    const { error } = await this.supabase
      .from("pending_actions")
      .update({ status: toDbPendingActionStatus(status) })
      .eq("id", existing.id);

    if (error) {
      throw new Error("[Memory] Pending action update error: " + error.message);
    }

    console.log(`[Memory] Pending action ${actionId} → ${status}`);
  }

  async getPendingAction(actionId: string): Promise<IPendingAction | null> {
    const { data, error } = await this.supabase
      .from("pending_actions")
      .select("*")
      .contains("metadata", { action_id: actionId })
      .maybeSingle();

    if (error) {
      console.warn("[Memory] Pending action lookup error:", error.message);
      return null;
    }

    if (!data) return null;
    return this.mapPendingActionRow(data);
  }
}

export const memoryManager = new MemoryManager();
