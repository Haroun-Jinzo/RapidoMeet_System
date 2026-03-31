/**
 * Centralized Service Configuration
 * 
 * This module consolidates all hardcoded values and configuration settings
 * for external services and tool classification. By centralizing config here,
 * we make it easy to modify settings without touching business logic.
 */

// ============================================================================
// N8N Webhook Configuration
// ============================================================================

/** Flag to enable/disable N8N webhook calls (useful for testing) */
export const N8N_ENABLED = process.env.N8N_ENABLED === 'true' || false;

/** Base URL for N8N automation platform */
export const N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5679';

/** Map of tool names to their N8N webhook paths
 * Each key is a tool name, value is the corresponding webhook path
 */
export const WEBHOOK_PATHS: Record<string, string> = {
  'create_crm_task': '/webhook/create-crm-task',
  'update_crm_contact': '/webhook/update-crm-contact',
  'add_prospect': '/webhook/add-prospect',
  'send_email': '/webhook/send-email',
  'log_event': '/webhook/log-event',
  'create_calendar_event': '/webhook/create-calendar-event',
};

// ============================================================================
// MCP Tool Classification
// ============================================================================

/** Critical tools that ALWAYS require user confirmation before execution
 * These tools modify sensitive data and should never run automatically
 */
export const ALWAYS_CRITICAL_TOOLS = new Set([
  'crm.create_contact',
  'crm.create_opportunity',
  'calendar.create_event',
  'n8n.trigger_workflow', // depends on workflow, defaulting to critical
]);

/** Safe tools that NEVER require confirmation and can run automatically        
 * These tools are read-only or informational with no side effects
 */
export const NEVER_CRITICAL_TOOLS = new Set([
  'email.send_recap',
  'crm.log_activity',
  'db.save_task',]);
// ============================================================================

/** Groq API configuration for speech-to-text transcription */
export const GROQ_CONFIG = {
  model: 'whisper-large-v3',
  maxFileSize: 25 * 1024 * 1024, // 25MB - Groq's limit
};

/** Local Whisper configuration (faster-whisper) */
export const LOCAL_WHISPER_CONFIG = {
  enabled: true,
  model: 'base', // large-v3, base, small, tiny (using base for faster CPU inference)
  device: 'auto', // 'auto', 'cpu', 'cuda'
  computeType: 'float32', // 'float32', 'float16', 'int8'
  sizeLimitForLocal: 24 * 1024 * 1024, // Use local whisper only for files > 24MB (Groq handles up to 25MB)
};

/** Google Gemini API configuration for NLP tasks */
export const GEMINI_CONFIG = {
  model: 'gemini-2.5-flash-lite',
  temperature: 0.3, // Low temperature for consistent, deterministic outputs    
};

// ============================================================================
// Resilience & Retry Configuration
// ============================================================================

/** Retry policy for external API calls */
export const RETRY_CONFIG = {
  maxAttempts: 3,
  backoffMultiplier: 2, // Exponential backoff: 1s, 2s, 4s
  initialDelayMs: 1000,
  maxDelayMs: 8000,
};

/** Circuit breaker thresholds for failing external services */
export const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5, // Open circuit after 5 consecutive failures
  successThreshold: 2, // Close circuit after 2 consecutive successes
  timeout: 5200000, // Try to recover after 600 seconds (10 minutes) - needed for large audio files
};

// ============================================================================
// Server Configuration
// ============================================================================

/** Express server port */
export const SERVER_PORT = parseInt(process.env.PORT || '3000');

/** Maximum request payload size for file uploads */
export const MAX_REQUEST_SIZE = '50mb';

/** CORS configuration */
export const CORS_CONFIG = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
};

// ============================================================================
// Session Management Configuration
// ============================================================================

/** Redis session storage timeout (ms) */
export const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/** How long to keep pending action confirmations */
export const ACTION_CONFIRMATION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
