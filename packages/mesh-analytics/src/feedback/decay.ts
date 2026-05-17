import type { LearnedRule } from "../reflection/store.js";

const DECAY_THRESHOLD_DAYS = 30;
const DECAY_RATE_PER_WEEK = 0.1;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export function applyDecay(rules: LearnedRule[], now: Date = new Date()): LearnedRule[] {
  return rules.map((rule) => {
    const lastUsed = rule.lastApplied ?? rule.createdAt;
    const daysSinceUse = (now.getTime() - lastUsed.getTime()) / (24 * 60 * 60 * 1000);

    if (daysSinceUse <= DECAY_THRESHOLD_DAYS) {
      return rule;
    }

    const weeksOverdue = (daysSinceUse - DECAY_THRESHOLD_DAYS) / 7;
    const decayAmount = weeksOverdue * DECAY_RATE_PER_WEEK;
    const newConfidence = Math.max(0, rule.confidence - decayAmount);

    return { ...rule, confidence: newConfidence };
  });
}

export function archiveStaleRules(rules: LearnedRule[], threshold: number = 0.3): LearnedRule[] {
  return rules.filter((r) => r.confidence < threshold);
}
