export type MeetingType =
  | "commercial"   // Sales meetings — activates commercial.md
  | "tech"         // Sprint reviews, architecture — activates tech.md
  | "retro"        // Team retrospectives — activates retro.md
  | "onboarding"   // New client setup — activates onboarding.md
  | "general"
  | "phone_call";    // Phone calls — activates phone_call.md
