import { MeetingType } from "./MeetingType";
import { ISessionContext } from "./ISessionContext";

export interface ISessionManager {
  create(
    userId:       string,
    meetingTitle: string,
    meetingType:  MeetingType
  ): Promise<ISessionContext>;

  save(session: ISessionContext): Promise<void>;

  load(sessionId: string): Promise<ISessionContext | null>;
}
