import WebSocket from "ws";

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

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private reconnectInterval = 3000;
  private maxReconnectAttempts = 10;
  private attempts = 0;

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

    // Connect with token header or query string based on external API requirements
    this.ws = new WebSocket(this.url, {
      headers: {
        "Authorization": `Bearer ${this.token}`,
      }
    });

    this.ws.on("open", () => {
      console.log(`[OpenClaw] Connected to ${this.url}`);
      this.attempts = 0; // reset
    });

    this.ws.on("message", (data) => {
      console.log("[OpenClaw] Received message:", data.toString());
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
      console.error("[OpenClaw] Max reconnect attempts reached.");
    }
  }

  public async sendReport(type: OpenClawMessageType, payload: OpenClawPayload): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[OpenClaw] Cannot send message, WebSocket is not connected or open");
      return;
    }

    const message = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString()
    });

    return new Promise((resolve, reject) => {
      this.ws!.send(message, (err) => {
        if (err) {
          console.error(`[OpenClaw] Failed to send message of type ${type}:`, err);
          return reject(err);
        }
        console.log(`[OpenClaw] Sent message of type ${type} for session ${payload.session_id}`);
        resolve();
      });
    });
  }
}

export const openclawClient = new OpenClawClient();
