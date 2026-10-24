import { isCrmCriticalTool, isCrmReadTool } from "./crmTools";
import { isCmsCriticalTool, isCmsReadTool } from "./cmsTools";
import { isRhCriticalTool, isRhReadTool } from "./rhTools";

export const ALWAYS_CRITICAL_TOOLS = new Set<string>([
  "n8n_trigger_workflow",
  "calendar_create_event",
]);


export const NEVER_CRITICAL_TOOLS = new Set<string>([
  "email_send_recap",
  "db_save_task",
  "crm_log_activity",
]);


export function requiresConfirmationForTool(tool: string, geminiSays?: boolean): boolean {
  if (isCrmCriticalTool(tool) || isCmsCriticalTool(tool) || isRhCriticalTool(tool)) return true;
  if (isCrmReadTool(tool) || isCmsReadTool(tool) || isRhReadTool(tool)) return false;
  if (ALWAYS_CRITICAL_TOOLS.has(tool)) return true;
  if (NEVER_CRITICAL_TOOLS.has(tool)) return false;
  return geminiSays ?? false;
}

export const GROQ_CONFIG = {
  model: 'whisper-large-v3',
  maxFileSize: 10 * 1024 * 1024, // 25MB - Groq's limit
};


export const LOCAL_WHISPER_CONFIG = {
  enabled: true,
  model: 'base', 
  device: 'auto',
  computeType: 'float32',
  sizeLimitForLocal: 10 * 1024 * 1024, 
};


export const GEMINI_CONFIG = {
  model: 'gemini-2.5-flash-lite',
  temperature: 0.3, // Low temperature for consistent, deterministic outputs    
};

export const RETRY_CONFIG = {
  maxAttempts: 3,
  backoffMultiplier: 2,
  initialDelayMs: 1000,
  maxDelayMs: 8000,
};

export const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5, 
  successThreshold: 2, 
  timeout: 600, 
};


export const SERVER_PORT = parseInt(process.env.PORT || '3000');


export const MAX_REQUEST_SIZE = '50mb';


export const CORS_CONFIG = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:8080,http://localhost:8081',
  credentials: true,
};

export const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

export const ACTION_CONFIRMATION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
