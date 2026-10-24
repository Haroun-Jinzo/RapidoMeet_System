import { ProspectScore } from "./ProspectScore";

export interface IProspect {
  company:   string;         
  contact?:  string;         
  email?:    string;         
  phone?:    string;         
  score:     ProspectScore;  
  interest?: string;         
  nextStep?: string;         
}
