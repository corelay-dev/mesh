import type { EngagementRecord } from "../tracker/engagement.js";

export interface ABTestVariant {
  id: string;
  content: string;
  platform: string;
  segment: string;
}

export interface ABTest {
  id: string;
  campaignId: string;
  hypothesis: string;
  variants: ABTestVariant[];
  status: "running" | "concluded" | "cancelled";
  startedAt: Date;
  concludedAt?: Date;
  winner?: string;
}

export interface ABTestConfig {
  campaignId: string;
  hypothesis: string;
  variants: ABTestVariant[];
}

export interface ABTestStore {
  save(test: ABTest): Promise<void>;
  getById(id: string): Promise<ABTest | undefined>;
  getByCampaign(campaignId: string): Promise<ABTest[]>;
}

export class InMemoryABTestStore implements ABTestStore {
  private tests: ABTest[] = [];

  async save(test: ABTest): Promise<void> {
    const idx = this.tests.findIndex((t) => t.id === test.id);
    if (idx >= 0) {
      this.tests[idx] = test;
    } else {
      this.tests.push(test);
    }
  }

  async getById(id: string): Promise<ABTest | undefined> {
    return this.tests.find((t) => t.id === id);
  }

  async getByCampaign(campaignId: string): Promise<ABTest[]> {
    return this.tests.filter((t) => t.campaignId === campaignId);
  }
}

export function createABTest(config: ABTestConfig): ABTest {
  return {
    id: crypto.randomUUID(),
    campaignId: config.campaignId,
    hypothesis: config.hypothesis,
    variants: config.variants,
    status: "running",
    startedAt: new Date(),
  };
}

export function concludeTest(test: ABTest, engagementData: EngagementRecord[]): ABTest {
  const variantScores = new Map<string, number>();

  for (const variant of test.variants) {
    const records = engagementData.filter((e) => e.messageId === variant.id);
    const score = records.reduce((sum, r) => sum + r.likes + r.replies + r.shares, 0);
    variantScores.set(variant.id, score);
  }

  let winnerId: string | undefined;
  let maxScore = -1;
  for (const [id, score] of variantScores) {
    if (score > maxScore) {
      maxScore = score;
      winnerId = id;
    }
  }

  return {
    ...test,
    status: "concluded",
    concludedAt: new Date(),
    winner: winnerId,
  };
}
