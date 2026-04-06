/**
 * A decision made during the meeting.
 * Example: "On valide l'architecture N8N"
 */
export interface IDecision {
  text:   string;    // "Architecture N8N + Node.js validée"
  owner?: string;    // Who is responsible for this decision
}

/**
 * A prospect or client identified during a meeting.
 */
