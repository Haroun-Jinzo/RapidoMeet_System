import { Priority } from "./Priority";

/**
 * A task extracted from a meeting.
 * Example: "Thomas doit envoyer le devis avant vendredi"
 */
export interface ITask {
  title:     string;    // "Envoyer le devis à StartupX"
  assignee?: string;    // "Thomas" or "thomas@startupx.fr"
  deadline?: string;    // ISO date: "2026-03-21"
  priority:  Priority;  // Inferred from urgency of language
  source:    string;    // The exact quote that generated this task
}

/**
 * A decision made during the meeting.
 * Example: "On valide l'architecture N8N"
 */
