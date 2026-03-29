import { Tool } from "@google/generative-ai";

// Gemini wraps all functions inside a "functionDeclarations" array
// inside a "tools" array. One tools object, many functions inside it.
export const GEMINI_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "create_crm_contact",
        description:
          "Create a new contact in RapidoCRM after a meeting. " +
          "Use this when a prospect or client was mentioned in a meeting " +
          "and needs to be added to the CRM system.",
        parameters: {
          type: "OBJECT" as any,
          properties: {
            first_name: {
              type: "STRING" as any,
              description: "Contact first name",
            },
            last_name: {
              type: "STRING" as any,
              description: "Contact last name",
            },
            email: {
              type: "STRING" as any,
              description: "Contact email address",
            },
            company: {
              type: "STRING" as any,
              description: "Company name",
            },
            notes: {
              type: "STRING" as any,
              description: "Notes from the meeting",
            },
            score: {
              type: "STRING" as any,
              description: "Prospect score: hot, warm, or cold",
            },
          },
          required: ["first_name", "last_name"],
        },
      },

      {
        name: "create_calendar_event",
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
        name: "send_meeting_recap",
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
    ],
  },
];