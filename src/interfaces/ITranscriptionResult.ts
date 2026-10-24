import { ISpeakerSegment } from "./ISpeakerSegment";

export interface ITranscriptionResult {
  transcript:  string;             
  segments:    ISpeakerSegment[];  
  duration:    number;             
  confidence:  number;             
  language:    string;             
}
