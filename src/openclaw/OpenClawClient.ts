import WebSocket from "ws";
import crypto from "crypto";

export interface OpenClawPayload {
  session_id: string;
  user_id: string;
  transcript_summary?: string;
  extraction_json?: any;
  proposed_actions?: any[];
  [key: string]: any;
}

export type OpenClawMessageType = 
  | "meeting.completed" 
  | "meeting.awaiting_confirmation"
  | "meeting.action_confirmed"
  | "meeting.action_refused";

interface Envelope {
  message_id: string;
  session_id: string;
  event_type: OpenClawMessageType;
  sent_at: string;
  payload: OpenClawPayload;
}

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private reconnectInterval = 3000;
  private maxReconnectAttempts = 10;
  private attempts = 0;
  
  // In-memory ACK tracking
  private pendingAcks: Map<string, Envelope> = new Map();

  constructor() {
    this.url = process.env.OPENCLAW_WS_URL || "wss://openclaw-dev.braindcode.com";
    this.token = process.env.OPENCLAW_WS_TOKEN || "";
  }

  public connect() {
    if (process.env.USE_OPENCLAW === "false") {
      console.log("[OpenClaw] USE_OPENCLAW is false. Skipping WS connection.");
      return;
    }

    if (!this.token) {
      console.warn("[OpenClaw] Missing OPENCLAW_WS_TOKEN. Skipping WS connection.");
      return;
    }

    this.ws = new WebSocket(this.url, {
      headers: {
        "Authorization": `Bearer ${this.token}`,
      }
    });

    this.ws.on("open", () => {
      console.log(`[OpenClaw] Connected to ${this.url}`);
      this.attempts = 0; // reset
      this.flushPendingMessages();
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ack" && msg.message_id) {
          console.log(`[OpenClaw] Received ACK for message: ${msg.message_id}`);
          this.pendingAcks.delete(msg.message_id);
        } else {
          console.log(
            `[OpenClaw] Received message type: ${typeof msg?.type === "string" ? msg.type : "unknown"}`
          );
        }
      } catch (err) {
        console.log("[OpenClaw] Received non-JSON message:", data.toString());
      }
    });

    this.ws.on("close", () => {
      console.warn("[OpenClaw] Disconnected");
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      console.error("[OpenClaw] WebSocket error:", error.message);
      // 'close' event will follow.
    });
  }

  private scheduleReconnect() {
    if (this.attempts < this.maxReconnectAttempts) {
      this.attempts++;
      console.log(`[OpenClaw] Reconnecting in ${this.reconnectInterval}ms (Attempt ${this.attempts})`);
      setTimeout(() => this.connect(), this.reconnectInterval);
    } else {
      console.error("[OpenClaw] Max reconnect attempts reached. Pending messages may be lost or should trigger HTTP webhook fallback.");
      // this.triggerHttpFallback();
    }
  }

  private async flushPendingMessages() {
    if (this.pendingAcks.size === 0) return;
    console.log(`[OpenClaw] Flushing ${this.pendingAcks.size} pending messages...`);
    for (const [msgId, envelope] of Array.from(this.pendingAcks.entries())) {
      try {
        await this._sendRaw(envelope);
      } catch (e) {
        console.warn(`[OpenClaw] Failed to flush message ${msgId}`);
      }
    }
  }

  private _sendRaw(envelope: Envelope): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("WebSocket not open"));
      }
      const message = JSON.stringify(envelope);
      this.ws.send(message, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  public async sendReport(type: OpenClawMessageType, payload: OpenClawPayload): Promise<void> {
    const envelope: Envelope = {
      message_id: crypto.randomUUID(),
      session_id: payload.session_id,
      event_type: type,
      sent_at: new Date().toISOString(),
      payload
    };

    // Require ACK mostly for completed / action_confirmed
    if (type === "meeting.completed" || type === "meeting.action_confirmed") {
        this.pendingAcks.set(envelope.message_id, envelope);
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[OpenClaw] WS not open. Queued message ${envelope.message_id} of type ${type}`);
      return; // Will be flushed on reconnect
    }

    try {
      await this._sendRaw(envelope);
      console.log(`[OpenClaw] Sent message ${envelope.message_id} of type ${type} for session ${payload.session_id}`);
    } catch (err) {
      console.error(`[OpenClaw] Failed to send message of type ${type}:`, err);
    }
  }
}

export const openclawClient = new OpenClawClient();
