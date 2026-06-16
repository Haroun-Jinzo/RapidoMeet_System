import { Tool } from "@google/generative-ai";
import { buildCrmGeminiDeclarations } from "../config/crmTools";

const crmDeclarations = buildCrmGeminiDeclarations().map((decl) => ({
  name: decl.name as string,
  description: decl.description as string,
  parameters: decl.parameters as any,
}));

// Gemini wraps all functions inside a "functionDeclarations" array
// inside a "tools" array. One tools object, many functions inside it.
export const GEMINI_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      ...crmDeclarations,
      {
        name: "calendar_create_event",
        description:
          "Create a Google Calendar event for a follow-up meeting. " +
          "Use this when a next meeting or call was agreed upon.",
        parameters: {
          type: "OBJECT" as any,
          properties: {
            title: {
              type: "STRING" as any,
              description: "Event title",
            },
            date: {
              type: "STRING" as any,
              description: "Date in ISO format YYYY-MM-DD",
            },
            time: {
              type: "STRING" as any,
              description: "Time in HH:MM format",
            },
            duration_minutes: {
              type: "NUMBER" as any,
              description: "Duration in minutes",
            },
            participants: {
              type: "ARRAY" as any,
              items: { type: "STRING" as any },
              description: "List of participant email addresses",
            },
            description: {
              type: "STRING" as any,
              description: "Event description or agenda",
            },
          },
          required: ["title", "date", "time"],
        },
      },
      {
        name: "email_send_recap",
        description:
          "Send a formatted meeting recap via email and WhatsApp. " +
          "Use this after every meeting to distribute the summary and action items.",
        parameters: {
          type: "OBJECT" as any,
          properties: {
            meeting_title: {
              type: "STRING" as any,
            },
            summary: {
              type: "STRING" as any,
              description: "2-3 sentence meeting summary",
            },
            decisions: {
              type: "ARRAY" as any,
              items: { type: "STRING" as any },
              description: "List of decisions made",
            },
            action_items: {
              type: "ARRAY" as any,
              items: { type: "STRING" as any },
              description: "List of action items with assignees and deadlines",
            },
            participants: {
              type: "ARRAY" as any,
              items: { type: "STRING" as any },
              description: "Participant email addresses",
            },
          },
          required: ["meeting_title", "summary"],
        },
      },
      {
        name: "db_save_task",
        description: "Save an action item to the local task database.",
        parameters: {
          type: "OBJECT" as any,
          properties: {
            title:    { type: "STRING" as any, description: "Task title" },
            assignee: { type: "STRING" as any, description: "Person responsible" },
            deadline: { type: "STRING" as any, description: "ISO date YYYY-MM-DD" },
            priority: { type: "STRING" as any, description: "high, medium, or low" },
            source:   { type: "STRING" as any, description: "Quote from transcript" },
          },
          required: ["title"],
        },
      },
      {
        name: "n8n_trigger_workflow",
        description: "Trigger a custom n8n automation workflow.",
        parameters: {
          type: "OBJECT" as any,
          properties: {
            workflow_id: { type: "STRING" as any },
            payload:     { type: "OBJECT" as any },
          },
          required: ["workflow_id"],
        },
      },
    ] as any,
  },
];
