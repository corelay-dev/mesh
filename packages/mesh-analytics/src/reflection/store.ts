export interface LearnedRule {
  id: string;
  campaignId: string;
  rule: string;
  confidence: number;
  source: string;
  createdAt: Date;
  lastApplied: Date | null;
  applicationCount: number;
}

export { RuleStore, InMemoryRuleStore } from "./update-prompt.js";
