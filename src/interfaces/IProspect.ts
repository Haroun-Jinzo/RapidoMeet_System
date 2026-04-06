import { ProspectScore } from "./ProspectScore";

/**
 * A prospect or client identified during a meeting.
 */
export interface IProspect {
  company:   string;         // "StartupX"
  contact?:  string;         // "Thomas Laurent"
  email?:    string;         // "thomas@startupx.fr"
  phone?:    string;         // "+33 6 12 34 56 78"
  score:     ProspectScore;  // hot/warm/cold based on meeting language
  interest?: string;         // "Plan Pro à 200€/mois"
  nextStep?: string;         // "Démo technique le 21 mars"
}

/**
 * The complete structured output of NLP analysis on a transcript.
 * This is what extract.ts produces and router.ts consumes.
 */
