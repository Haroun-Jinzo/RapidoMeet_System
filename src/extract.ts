/**
 * NLP Extraction Service using Google Gemini
 * 
 * This module extracts structured business data from meeting transcripts:
 * - Actionable tasks with deadlines and priorities
 * - Critical business decisions
 * - Sales leads and prospect information
 * - Overall sentiment and meeting summary
 * 
 * All Gemini output is validated using Zod schemas to catch hallucinations
 * and formatting errors before they propagate downstream.
 * 
 * Dependencies: Google Gemini 2.0 Flash API, Zod for validation
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z }                  from "zod";
import {
  ITaskExtractor,
  INLPOutput,
  ITask,
  IDecision,
  IProspect,
  MeetingType,
} from "./interfaces";
import { CircuitBreaker } from "./resilience/CircuitBreaker";
import { GEMINI_CONFIG, CIRCUIT_BREAKER_CONFIG } from "./config/services";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

/**
 * Zod schemas define the REQUIRED shape of Gemini's JSON responses
 * 
 * Why validate AI output?
 * - Gemini is powerful but not perfectly predictable
 * - It might omit fields, use wrong types, or include extra data
 * - Validation catches errors early before crashing downstream code
 * - Provides detailed error messages for debugging failed extractions
 * 
 * Rule: Never trust AI output without validation
 */

/** Schema for an individual task extracted from the transcript */
const TaskSchema = z.object({
  title:    z.string().min(1).describe("Action item title"),
  assignee: z.string().optional().nullable().describe("Person responsible"),
  deadline: z.string().optional().nullable().describe("YYYY-MM-DD or text description"),
  priority: z.enum(["high", "medium", "low"]).describe("Task urgency"),
  source:   z.string().min(1).describe("Exact quote from transcript"),
});

/** Schema for a business decision made during the meeting */
const DecisionSchema = z.object({
  text:  z.string().min(1).describe("What was decided"),
  owner: z.string().optional().nullable().describe("Responsible party"),
});

/** Schema for a sales lead or prospect mentioned */
const ProspectSchema = z.object({
  company:  z.string().min(1).describe("Company name"),
  contact:  z.string().optional().nullable().describe("Contact person"),
  email:    z.string().optional().nullable().describe("Contact email"),
  phone:    z.string().optional().nullable().describe("Contact phone"),
  score:    z.enum(["hot", "warm", "cold"]).describe("Sales qualification"),
  interest: z.string().optional().nullable().describe("What they're interested in"),
  nextStep: z.string().optional().nullable().describe("Agreed next action"),
});

/** Complete schema for Gemini response validation */
const NLPOutputSchema = z.object({
  summary:   z.string().min(10).describe("Meeting summary"),
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("Overall tone"),
  tasks:     z.array(TaskSchema).describe("Extracted action items"),
  decisions: z.array(DecisionSchema).describe("Strategic decisions"),
  prospects: z.array(ProspectSchema).describe("Sales opportunities"),
  skillUsed: z.string().describe("Which skill was applied"),
});

// ============================================================================
// Task Extractor Class
// ============================================================================

class TaskExtractor implements ITaskExtractor {
  private genAI: GoogleGenerativeAI;
  private circuitBreaker: CircuitBreaker;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[TaskExtractor] GEMINI_API_KEY is not set in environment variables"
      );
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    
    // Initialize circuit breaker to protect against Gemini API failures
    // When Gemini experiences repeated timeouts/errors, circuit breaker
    // will fail fast instead of cascading into retry storms
    this.circuitBreaker = new CircuitBreaker('gemini-extractor', CIRCUIT_BREAKER_CONFIG);
    
    console.log("[TaskExtractor] Gemini client initialised with circuit breaker protection");
  }

  /**
   * Extract structured business data from meeting transcripts
   * 
   * Pipeline:
   * 1. Build prompt with active Skill instructions and transcript
   * 2. Call Gemini API via circuit breaker
   * 3. Parse JSON response and validate against Zod schema
   * 4. Return structured data or throw validation error
   * 
   * @param transcript - Full meeting transcript text
   * @param meetingType - Type of meeting (for context to Gemini)
   * @param skillContent - Active Skill instructions from .md file
   * @returns Structured extraction: tasks, decisions, prospects
   * @throws Error if API fails, JSON invalid, or validation fails
   */
  async extract(
    transcript:   string,
    meetingType:  MeetingType,
    skillContent: string
  ): Promise<INLPOutput> {
    console.log(
      `[TaskExtractor] Starting NLP extraction — ` +
      `type: ${meetingType}, ` +
      `transcript length: ${transcript.length} chars`
    );

    const startTime = Date.now();

    // Build the system prompt (constant across all requests)
    const systemPrompt = this.buildSystemPrompt();

    // Build the user prompt (varies per transcript)
    const userPrompt = this.buildUserPrompt(transcript, meetingType, skillContent);

    // Get model instance with configuration
    const model = this.genAI.getGenerativeModel({
      model: GEMINI_CONFIG.model,  // e.g., "gemini-2.0-flash"
      systemInstruction: systemPrompt,
      generationConfig: {
        // Force JSON output to prevent markdown wrapping (```json...```)
        responseMimeType: "application/json",
        
        // Low temperature for consistent, deterministic extraction
        // Higher values = more creative/unpredictable output (we don't want that)
        temperature: GEMINI_CONFIG.temperature,
        
        // Usually 500-1500 tokens for extraction results
        maxOutputTokens: 2048,
      },
    });

    try {
      // Call Gemini within circuit breaker protection with timeout
      // If Gemini API is experiencing repeated failures, the circuit breaker
      // will reject this call immediately without making an API request
      // Timeout: 60 seconds to prevent indefinite hanging
      const result = await Promise.race([
        this.circuitBreaker.execute(async () => {
          return await model.generateContent(userPrompt);
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Gemini extraction timeout (60s)')), 60_000)
        )
      ]) as any;

      const response = result.response;
      const rawText  = response.text();

      console.log(
        `[TaskExtractor] Gemini responded — ` +
        `${rawText.length} chars, ` +
        `elapsed: ${Date.now() - startTime}ms`
      );

      // Parse JSON and validate against Zod schema
      // This catches hallucinations, missing fields, and type mismatches
      const parsed = this.parseAndValidate(rawText, meetingType, skillContent);

      console.log(
        `[TaskExtractor] Extraction complete — ` +
        `tasks: ${parsed.tasks.length}, ` +
        `decisions: ${parsed.decisions.length}, ` +
        `prospects: ${parsed.prospects.length}, ` +
        `sentiment: ${parsed.sentiment}, ` +
        `time: ${Date.now() - startTime}ms`
      );

      return parsed;

    } catch (error) {
      const message = (error as Error).message;
      console.error("[TaskExtractor] Extraction failed:", message);
      throw new Error(`NLP extraction failed: ${message}`);
    }
  }

  /**
   * Build the system prompt (constant across all requests)
   * 
   * The system prompt defines Gemini's role and constrains its behavior.
   * It emphasizes structure, validation rules, and quality standards.
   * 
   * This prompt is returned directly by generateContent() config, so it
   * affects ALL requests from this model instance.
   * 
   * @returns System prompt string
   */
  private buildSystemPrompt(): string {
    return `
You are an expert AI assistant specialised in analysing professional meeting transcripts.

Your job is to extract structured information from meeting transcripts and return it as valid JSON.

STRICT RULES:
1. Return ONLY valid JSON — no markdown, no code blocks, no explanation text.
2. Never invent information not present in the transcript.
3. If a field is not mentioned in the transcript, use null for optional fields.
4. For tasks, always include the exact quote from the transcript that triggered the task in the "source" field.
5. For deadlines, always use ISO format: "YYYY-MM-DD". If only a day is mentioned ("vendredi"), calculate from context or write "vendredi prochain".
6. For prospect scores: "hot" = clear strong interest + budget + timeline, "warm" = interested but unclear next step, "cold" = mentioned but no clear interest.
7. Sentiment is about the overall meeting tone, not individual speakers — be generous with "positive" if most of meeting was constructive.
8. Respond in the same language as the transcript (French if French, English if English).
9. If no tasks/decisions/prospects are found, return empty arrays, not null.
`.trim();
  }

  /**
   * Build the user prompt for this specific request
   * 
   * The user prompt is unique per extraction. It contains:
   * - Active Skill instructions (from loaded .md file)
   * - Meeting type and context
   * - The transcript to analyze
   * - Exact JSON schema expected
   * 
   * Skill instructions appear first because Gemini weights earlier
   * instructions more heavily than later ones.
   * 
   * @param transcript - Full meeting transcript
   * @param meetingType - Context for the extraction
   * @param skillContent - Active Skill instructions
   * @returns User prompt string
   */
  private buildUserPrompt(
    transcript:   string,
    meetingType:  MeetingType,
    skillContent: string
  ): string {
    const formattedTranscript = transcript.trim();

    return `
## Active Skill Instructions
${skillContent}

## Meeting Context
Type: ${meetingType}
Date: ${new Date().toISOString().split('T')[0]}

## Transcript to Analyse
${formattedTranscript}

## Required Output Format
Return a JSON object with exactly this structure (and no other text):

{
  "summary": "2-3 sentence summary of the meeting in the transcript's language",
  "sentiment": "positive" | "neutral" | "negative",
  "tasks": [
    {
      "title": "Clear action item title",
      "assignee": "Person name or null",
      "deadline": "YYYY-MM-DD or description or null",
      "priority": "high" | "medium" | "low",
      "source": "Exact quote from transcript that created this task"
    }
  ],
  "decisions": [
    {
      "text": "What was decided",
      "owner": "Who is responsible or null"
    }
  ],
  "prospects": [
    {
      "company": "Company name",
      "contact": "Person name or null",
      "email": "email@example.com or null",
      "phone": "+33... or null",
      "score": "hot" | "warm" | "cold",
      "interest": "What they are interested in or null",
      "nextStep": "Agreed next action or null"
    }
  ],
  "skillUsed": "${meetingType}"
}

Return ONLY the JSON object. No other text, no markdown formatting.
`.trim();
  }

  /**
   * Parse and validate Gemini's JSON response
   * 
   * Two-phase process:
   * 1. Parse raw JSON (handle markdown wrapping edge cases)
   * 2. Validate shape/types with Zod
   * 3. Convert nulls to undefined (JS convention)
   * 
   * Zod provides detailed error messages if validation fails,
   * which we log for debugging.
   * 
   * @param rawText - Raw response from Gemini
   * @param meetingType - Type of meeting (for fallback skillUsed)
   * @param skillContent - Skill content (for reference only)
   * @returns Validated INLPOutput object
   * @throws Error if JSON parsing or validation fails
   */
  private parseAndValidate(
    rawText:      string,
    meetingType:  MeetingType,
    skillContent: string
  ): INLPOutput {
    // Step 1: Parse JSON (defensively strip markdown wrapping)
    let parsed: unknown;
    try {
      // Sometimes Gemini wraps JSON in ```json ... ``` even with responseMimeType
      // We strip these defensive measures to handle edge cases
      const cleaned = rawText
        .replace(/^```json\s*/i, "")  // Remove opening ```json
        .replace(/^```\s*/i, "")      // Remove opening ```
        .replace(/```\s*$/i, "")      // Remove closing ```
        .trim();

      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `Gemini returned invalid JSON. First 200 chars: ${rawText.substring(0, 200)}`
      );
    }

    // Step 2: Validate with Zod
    // Zod checks: required fields, correct types, valid enum values, array elements
    const validationResult = NLPOutputSchema.safeParse(parsed);

    if (!validationResult.success) {
      // Extract detailed error information for logging
      const errors = validationResult.error.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");

      console.error("[TaskExtractor] Zod validation failed:", errors);
      console.error("[TaskExtractor] Raw parsed object:", JSON.stringify(parsed, null, 2));

      throw new Error(`Gemini response validation failed: ${errors}`);
    }

    // Step 3: Convert nulls to undefined (Zod result uses null, but our interfaces use undefined)
    const validated = validationResult.data;

    // Convert null → undefined for all optional fields
    // This is a JS convention: undefined means "not provided", null means "explicitly null"
    // Our type definitions use undefined, so we need this conversion
    return {
      summary:   validated.summary,
      sentiment: validated.sentiment,
      skillUsed: validated.skillUsed || meetingType,

      tasks: validated.tasks.map((t): ITask => ({
        title:    t.title,
        assignee: t.assignee  ?? undefined,
        deadline: t.deadline  ?? undefined,
        priority: t.priority,
        source:   t.source,
      })),

      decisions: validated.decisions.map((d): IDecision => ({
        text:  d.text,
        owner: d.owner ?? undefined,
      })),

      prospects: validated.prospects.map((p): IProspect => ({
        company:  p.company,
        contact:  p.contact  ?? undefined,
        email:    p.email    ?? undefined,
        phone:    p.phone    ?? undefined,
        score:    p.score,
        interest: p.interest ?? undefined,
        nextStep: p.nextStep ?? undefined,
      })),
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global task extractor instance
 * 
 * Exported as singleton so all modules share the same Gemini client.
 * Reduces initialization overhead and reuses API connections.
 * 
 * Usage in other modules:
 *   import { taskExtractor } from './extract';
 *   await taskExtractor.extract(transcript, meetingType, skillContent);
 */
export const taskExtractor = new TaskExtractor();