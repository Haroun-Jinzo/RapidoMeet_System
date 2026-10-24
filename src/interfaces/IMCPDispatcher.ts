import { IAction } from "./IAction";
import { IDispatchResult } from "./IDispatchResult";

export interface IMCPDispatcher {
  execute(action: IAction, apiKeys?: any): Promise<IDispatchResult>;

  executeAll(
    actions:   IAction[],
    sessionId: string,
    apiKeys?:  any,
    context?:  { userId: string }
  ): Promise<IDispatchResult[]>;

  resume(
    action:    IAction,
    sessionId: string,
    apiKeys?:  any
  ): Promise<IDispatchResult>;
}
