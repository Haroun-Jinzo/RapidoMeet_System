import { INLPOutput } from "./INLPOutput";
import { IAction } from "./IAction";
import { IDispatchResult } from "./IDispatchResult";
import { IFormattedReport } from "./IFormattedReport";
import { INotificationResult } from "./INotificationResult";

/**
 * Everything that happened during one full pipeline execution.
 * Returned by the orchestrate() function in index.ts.
 */
export interface IPipelineResult {
  sessionId:     string;
  transcript:    string;
  extraction:    INLPOutput;
  actions:       IAction[];
  results:       IDispatchResult[];
  report:        IFormattedReport;
  notifications: INotificationResult[];
  durationMs:    number;   // Total processing time in milliseconds
}
