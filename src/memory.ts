import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import { IMemoryManager, ISessionContext, IMeetingRecord, ITask } from "./interfaces";
import { sessionManager } from "./session";

class MemoryManager implements IMemoryManager {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    this.supabase = createClient(supabaseUrl, supabaseKey);
    console.log("[Memory] Supabase client initialized");
  }

  async cacheSession(session: ISessionContext, ttlSeconds: number = 7200): Promise<void> {
    await sessionManager.save(session);
  }
  async getSession(sessionId: string): Promise<ISessionContext | null> {
    return sessionManager.load(sessionId);
  }
  async deleteSession(sessionId: string): Promise<void> {
    return sessionManager.delete(sessionId);
  }

  async saveMeeting(meeting: Omit<IMeetingRecord, "id">): Promise<string> {
    const id = crypto.randomUUID();
    // Ensure duration is an integer to match DB column type (avoid 'invalid input syntax for type integer')
    const rawDuration = meeting.duration;
    const parsedDuration = typeof rawDuration === "string" ? parseFloat(rawDuration) : rawDuration;
    const durationInt = Number.isFinite(parsedDuration as any) ? Math.round(parsedDuration as number) : 0;

    const { data, error } = await this.supabase
      .from("meetings")
      .insert({
        id,
        user_id: meeting.userId,
        title: meeting.title,
        type: meeting.type,
        transcript: meeting.transcript,
        extraction: meeting.extraction,
        actions: meeting.actions,
        created_at: meeting.createdAt instanceof Date ? meeting.createdAt.toISOString() : meeting.createdAt,
        duration: durationInt
      })
      .select("id").single();

    if (error) throw new Error("[Memory] Supabase Meeting Insert Error: " + error.message);
    return data.id;
  }

  async getMeeting(meetingId: string): Promise<IMeetingRecord | null> {
    const { data, error } = await this.supabase
      .from("meetings").select("*").eq("id", meetingId).single();

    if (error || !data) return null;

    return { id: data.id, userId: data.user_id, title: data.title, type: data.type, transcript: data.transcript, extraction: data.extraction, actions: data.actions, createdAt: new Date(data.created_at), duration: data.duration } as IMeetingRecord;
  }

  async listMeetings(userId: string, limit: number = 20): Promise<IMeetingRecord[]> {
    const { data, error } = await this.supabase
      .from("meetings").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);

    if (error) throw new Error("[Memory] List Meetings Error: " + error.message);

    return (data || []).map(row => ({ id: row.id, userId: row.user_id, title: row.title, type: row.type, transcript: row.transcript, extraction: row.extraction, actions: row.actions, createdAt: new Date(row.created_at), duration: row.duration })) as IMeetingRecord[];
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

  async listTasks(userId: string, onlyOpen: boolean = false): Promise<(ITask & { id: string; done: boolean })[]> {
    let query = this.supabase.from("tasks").select("*").eq("user_id", userId);
    if (onlyOpen) query = query.eq("done", false);
    query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw new Error("[Memory] List Tasks Error: " + error.message);

    const pScore = (p: string) => p === "high" ? 1 : p === "medium" ? 2 : p === "low" ? 3 : 4;
    const tasks = (data || []).map(row => ({ id: row.id, title: row.title, assignee: row.assignee, deadline: row.deadline, priority: row.priority, source: row.source, done: row.done }));
    return tasks.sort((a, b) => pScore(a.priority) - pScore(b.priority));
  }

  async markTaskDone(taskId: string): Promise<void> {
    await this.supabase.from("tasks").update({ done: true }).eq("id", taskId);
    console.log("[Memory] Task done: " + taskId);
  }

  async disconnect(): Promise<void> { }
}

export const memoryManager = new MemoryManager();
