import type { TokenUsageExt, BudgetConfig } from "./types.js";
import { BudgetExceededError } from "./types.js";

export interface ModelPricing {
  /** Cost per 1M input tokens in USD. */
  inputPerMillion: number;
  /** Cost per 1M output tokens in USD. */
  outputPerMillion: number;
  /** Cost per 1M cached input tokens in USD. If omitted, defaults to inputPerMillion. */
  cachedInputPerMillion?: number;
}

/**
 * Default pricing table for common models. Prices as of 2026-07.
 * Users can supply their own table to override or extend.
 */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10, cachedInputPerMillion: 1.25 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6, cachedInputPerMillion: 0.075 },
  "gpt-4.1": { inputPerMillion: 2.0, outputPerMillion: 8.0, cachedInputPerMillion: 0.5 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6, cachedInputPerMillion: 0.1 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4, cachedInputPerMillion: 0.025 },
  "o3": { inputPerMillion: 2.0, outputPerMillion: 8.0, cachedInputPerMillion: 0.5 },
  "o3-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4, cachedInputPerMillion: 0.55 },
  "o4-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4, cachedInputPerMillion: 0.275 },

  // Anthropic
  "claude-sonnet-4-20250514": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  "claude-3-7-sonnet-20250219": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  "claude-3-5-sonnet-latest": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  "claude-3-5-sonnet-20241022": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  "claude-3-5-haiku-20241022": { inputPerMillion: 0.8, outputPerMillion: 4, cachedInputPerMillion: 0.08 },
  "claude-opus-4-20250514": { inputPerMillion: 15, outputPerMillion: 75, cachedInputPerMillion: 1.5 },

  // Bedrock Anthropic (same pricing, different model IDs)
  "anthropic.claude-3-5-sonnet-20241022-v2:0": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  "anthropic.claude-3-5-haiku-20241022-v1:0": { inputPerMillion: 0.8, outputPerMillion: 4, cachedInputPerMillion: 0.08 },
  "anthropic.claude-sonnet-4-20250514-v1:0": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
};

/**
 * Compute USD cost from token usage and model pricing.
 * Returns undefined if model is not in the pricing table.
 */
export function computeCost(
  usage: TokenUsageExt,
  model: string,
  pricingTable: Record<string, ModelPricing> = DEFAULT_PRICING,
): number | undefined {
  const pricing = pricingTable[model];
  if (!pricing) return undefined;

  const cachedTokens = usage.cachedTokens ?? 0;
  const uncachedInputTokens = usage.promptTokens - cachedTokens;
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;

  const inputCost = (uncachedInputTokens / 1_000_000) * pricing.inputPerMillion;
  const cachedCost = (cachedTokens / 1_000_000) * cachedRate;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPerMillion;

  return inputCost + cachedCost + outputCost;
}

/**
 * Tracks cumulative spend across requests and enforces a budget cap.
 */
export class BudgetTracker {
  private spent = 0;
  private readonly maxCostUsd: number;

  constructor(config: BudgetConfig) {
    this.maxCostUsd = config.maxCostUsd;
  }

  /** Current cumulative spend. */
  get currentSpend(): number {
    return this.spent;
  }

  /** Remaining budget. */
  get remaining(): number {
    return Math.max(0, this.maxCostUsd - this.spent);
  }

  /**
   * Record a cost. Throws BudgetExceededError if cumulative spend exceeds the cap.
   * The check is post-hoc (after the request completes) to avoid blocking partial work.
   */
  record(cost: number): void {
    this.spent += cost;
    if (this.spent > this.maxCostUsd) {
      throw new BudgetExceededError(this.spent, this.maxCostUsd);
    }
  }

  /** Reset the tracker (e.g. for a new session). */
  reset(): void {
    this.spent = 0;
  }
}
