import { MeetingType } from "./MeetingType";
import { INLPOutput } from "./INLPOutput";
import { IAction } from "./IAction";
import { ISpeakerSegment } from "./ISpeakerSegment";

export interface ISessionContext {
  id:            string;        
  userId:        string;        
  meetingId?:    string;        
  meetingTitle:  string;        
  meetingType:   MeetingType;   
  participants:  string[];      
  startedAt:     Date;          
  status:        "processing"   
                | "awaiting_confirmation"  
                | "complete"              
                | "error"                 
                | "cancelled";            

  transcript?:   string;
  transcriptionSegments?: ISpeakerSegment[];
  durationSeconds?: number;
  extraction?:   INLPOutput;
  actions?:      IAction[];
}
