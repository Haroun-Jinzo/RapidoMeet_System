import { Priority } from "./Priority";

export interface ITask {
  title:     string;    
  assignee?: string;    
  deadline?: string;    
  priority:  Priority;  
  source:    string;   
}