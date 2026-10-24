import { IAction } from "./IAction";

export interface IDispatchResult {
  actionId:  string;   // Matches IAction.id
  success:   boolean;
  result?:   string;   // result of the action execution (if success)
  error?:    string;   // Error message on failure
  retries:   number;   // How many times we retried (max 3)
}

