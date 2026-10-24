import { INLPOutput } from "./INLPOutput";
import { IAction } from "./IAction";

export interface IIntentRouter {
  decide(
    extraction:   INLPOutput,  // What was found in the meeting
    sessionId:    string,      // For logging and tracing
    skillContent: string,       // Active Skill file may override routing rules
    userInstructions?: string,       // Optional user instructions for routing
    apiKeys?: any
  ): Promise<IAction[]>;
}
