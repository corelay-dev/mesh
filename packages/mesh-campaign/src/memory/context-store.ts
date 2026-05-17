import type { CampaignPromptContext, PromptContextStore } from "./prompt-builder.js";
import type { BrandVoice } from "./brand-voice.js";

/**
 * In-memory implementation of PromptContextStore.
 * Useful for testing and lightweight deployments.
 * Production consumers should implement a Postgres-backed version.
 */
export class MemoryContextStore implements PromptContextStore {
  private contexts = new Map<string, CampaignPromptContext>();

  set(campaignId: string, ctx: CampaignPromptContext): void {
    this.contexts.set(campaignId, ctx);
  }

  async loadContext(campaignId: string, _agentId: string): Promise<CampaignPromptContext> {
    return this.contexts.get(campaignId) ?? {
      candidateProfile: [],
      keyPolicies: [],
      donts: [],
      brandVoice: null,
      learnedRules: [],
      historicalPerformance: [],
    };
  }

  /** Helper to create a context with brand voice */
  static withBrandVoice(campaignId: string, voice: BrandVoice, overrides?: Partial<CampaignPromptContext>): MemoryContextStore {
    const store = new MemoryContextStore();
    store.set(campaignId, {
      candidateProfile: overrides?.candidateProfile ?? [],
      keyPolicies: overrides?.keyPolicies ?? [],
      donts: overrides?.donts ?? [],
      brandVoice: voice,
      learnedRules: overrides?.learnedRules ?? [],
      historicalPerformance: overrides?.historicalPerformance ?? [],
    });
    return store;
  }
}
