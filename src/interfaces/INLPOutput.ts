import { ITask } from "./ITask";
import { IDecision } from "./IDecision";
import { IProspect } from "./IProspect";

export interface INLPOutput {
  summary:   string;                        // meeting summary
  sentiment: "positive" | "neutral" | "negative";
  tasks:     ITask[];
  decisions: IDecision[];
  prospects: IProspect[];
  skillUsed: string;  // Name of the .md file that was active: "commercial"
}
