import { MeetingType } from "./MeetingType";
import { INLPOutput } from "./INLPOutput";

export interface ITaskExtractor {
  extract(
    transcript:   string,      // Full meeting transcript text
    meetingType:  MeetingType, // Guides the extraction focus
    skillContent: string,      // Contents of the active .md Skill file
    apiKeys?:     any
  ): Promise<INLPOutput>;
}
