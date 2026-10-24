import { ISkill } from "./ISkill";

export interface ISkillRegistry {
  loadAll(): Promise<void>;

  get(skillName: string): ISkill | null;

  detect(transcript: string): ISkill;
}
