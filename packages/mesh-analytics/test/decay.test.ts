import { describe, it, expect } from "vitest";
import { applyDecay, archiveStaleRules } from "../src/feedback/decay.js";
import type { LearnedRule } from "../src/reflection/store.js";

function makeRule(overrides: Partial<LearnedRule> = {}): LearnedRule {
  return {
    id: "rule-1",
    campaignId: "camp-1",
    rule: "Keep messages short",
    confidence: 0.8,
    source: "msg-1",
    createdAt: new Date("2026-04-01"),
    lastApplied: new Date("2026-04-01"),
    applicationCount: 5,
    ...overrides,
  };
}

describe("applyDecay", () => {
  it("does not decay rules applied within 30 days", () => {
    const now = new Date("2026-04-20");
    const rules = [makeRule({ lastApplied: new Date("2026-04-10") })];
    const result = applyDecay(rules, now);
    expect(result[0]!.confidence).toBe(0.8);
  });

  it("decays rules not applied in 30+ days", () => {
    const now = new Date("2026-05-15");
    const rules = [makeRule({ lastApplied: new Date("2026-04-01") })];
    const result = applyDecay(rules, now);
    expect(result[0]!.confidence).toBeLessThan(0.8);
  });

  it("decays by 10% per week overdue", () => {
    const now = new Date("2026-05-15"); // 44 days since April 1
    const rules = [makeRule({ lastApplied: new Date("2026-04-01") })];
    const result = applyDecay(rules, now);
    // 44 days - 30 threshold = 14 days overdue = 2 weeks = 0.2 decay
    expect(result[0]!.confidence).toBeCloseTo(0.6, 1);
  });

  it("does not go below 0", () => {
    const now = new Date("2026-08-01"); // very old
    const rules = [makeRule({ confidence: 0.1, lastApplied: new Date("2026-01-01") })];
    const result = applyDecay(rules, now);
    expect(result[0]!.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe("archiveStaleRules", () => {
  it("returns rules below threshold", () => {
    const rules = [
      makeRule({ id: "r1", confidence: 0.2 }),
      makeRule({ id: "r2", confidence: 0.5 }),
      makeRule({ id: "r3", confidence: 0.1 }),
    ];
    const stale = archiveStaleRules(rules);
    expect(stale).toHaveLength(2);
    expect(stale.map((r) => r.id)).toContain("r1");
    expect(stale.map((r) => r.id)).toContain("r3");
  });

  it("uses custom threshold", () => {
    const rules = [makeRule({ confidence: 0.4 })];
    const stale = archiveStaleRules(rules, 0.5);
    expect(stale).toHaveLength(1);
  });
});
