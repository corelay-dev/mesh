import type { LearnedRule } from "./store.js";

export interface RuleStore {
  getRules(campaignId: string): Promise<LearnedRule[]>;
  addRule(rule: LearnedRule): Promise<void>;
  updateConfidence(ruleId: string, delta: number): Promise<void>;
  archiveRule(ruleId: string): Promise<void>;
}

export class InMemoryRuleStore implements RuleStore {
  private rules: LearnedRule[] = [];

  async getRules(campaignId: string): Promise<LearnedRule[]> {
    return this.rules.filter((r) => r.campaignId === campaignId);
  }

  async addRule(rule: LearnedRule): Promise<void> {
    this.rules.push(rule);
  }

  async updateConfidence(ruleId: string, delta: number): Promise<void> {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (rule) {
      rule.confidence = Math.min(1, Math.max(0, rule.confidence + delta));
    }
  }

  async archiveRule(ruleId: string): Promise<void> {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

export async function updatePromptRules(campaignId: string, newRule: LearnedRule, store: RuleStore): Promise<void> {
  const existing = await store.getRules(campaignId);
  const similar = existing.find((r) => wordOverlap(r.rule, newRule.rule) > 0.7);

  if (similar) {
    await store.updateConfidence(similar.id, 0.1);
  } else {
    await store.addRule(newRule);
  }
}
