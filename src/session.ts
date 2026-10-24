import Redis            from "ioredis";
import { nanoid }       from "nanoid";
import {
  ISessionManager,
  ISessionContext,
  MeetingType,
} from "./interfaces";

const SESSION_TTL_SECONDS = 60 * 60 * 2;

class SessionManager implements ISessionManager {

  // The Redis client — one connection shared across the entire app
  private redis: Redis | null = null;
  // Fallback in-memory storage for when Redis is unavailable
  private memoryStorage: Map<string, string> = new Map();
  private isRedisAvailable = false;

  constructor() {
    try {
      // Connect to Redis using the environment variable.
      this.redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        connectTimeout: 2000,
        tls: process.env.REDIS_URL?.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
      });

      this.redis.on("connect", () => {
        this.isRedisAvailable = true;
      });

      this.redis.on("error", () => {
        this.isRedisAvailable = false;
      });

      // Attempt initial connection
      this.redis.connect().catch(() => {
        console.warn("[Session] ⚠️  Could not connect to Redis — using in-memory storage for testing");
        this.isRedisAvailable = false;
      });
    } catch (err) {
      console.warn("[Session] ⚠️  Redis client initialization failed — using in-memory storage:", (err as Error).message);
      this.redis = null;
      this.isRedisAvailable = false;
    }
  }

  private makeKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private generateId(): string {
    const date = new Date()
      .toISOString()
      .slice(0, 10)          // "2026-03-14"
      .replace(/-/g, "");    // "20260314"
    const random = nanoid(6).toLowerCase(); // "a3f9k2"
    return `sess_${date}_${random}`;
  }

  async create(
    userId:       string,
    meetingTitle: string,
    meetingType:  MeetingType
  ): Promise<ISessionContext> {
    const session: ISessionContext = {
      id:           this.generateId(),
      userId,
      meetingTitle,
      meetingType,
      participants: [],           
      startedAt:    new Date(),
      status:       "processing", // Pipeline starts immediately
    };

    // Save to Redis immediately
    await this.save(session);

    console.log(`[Session] Created: ${session.id} (${meetingType})`);
    return session;
  }

  async save(session: ISessionContext): Promise<void> {
    const key  = this.makeKey(session.id);

    // JSON.stringify handles the Date objects — they become ISO strings.
    // When we load back, we convert them back to Date objects.
    const data = JSON.stringify(session);

    // Try Redis first, fall back to memory
    if (this.redis && this.isRedisAvailable) {
      try {
        await this.redis.set(key, data, "EX", SESSION_TTL_SECONDS);
      } catch {
        // If Redis fails, use memory storage
        this.memoryStorage.set(key, data);
      }
    } else {
      this.memoryStorage.set(key, data);
    }
  }

  async load(sessionId: string): Promise<ISessionContext | null> {
    const key  = this.makeKey(sessionId);
    let data: string | null = null;

    if (this.redis && this.isRedisAvailable) {
      try {
        data = await this.redis.get(key);
      } catch {
        data = this.memoryStorage.get(key) || null;
      }
    } else {
      data = this.memoryStorage.get(key) || null;
    }

    if (!data) {
      return null;
    }

    const parsed = JSON.parse(data);

    // Dates are stored as ISO strings — convert them back to Date objects
    return {
      ...parsed,
      startedAt: new Date(parsed.startedAt),
    } as ISessionContext;
  }
}

export const sessionManager = new SessionManager();