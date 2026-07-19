import type { LLMRequest, LLMResponse, TokenUsage, ToolCall } from "@corelay/mesh-core";
import type { ZodType } from "zod";

/**
 * Extended LLM request with opt-in features:
 * - Prompt caching
 * - Extended thinking / reasoning
 * - Streaming (via separate chatStream method)
 * - Structured outputs (strict tool schemas + response format)
 */
export interface LLMRequestExt extends LLMRequest {
  /** Opt-in: mark system prompt + tool definitions as cacheable prefix. */
  enablePromptCaching?: boolean;

  /**
   * Opt-in: extended thinking / reasoning budget.
   * For Anthropic: maps to extended thinking with budget_tokens.
   * For OpenAI: maps to reasoning_effort ("low" | "medium" | "high").
   */
  thinking?: ThinkingConfig;

  /**
   * Opt-in: enable provider-enforced strict schemas for tool definitions.
   * When true, OpenAI tools are sent with `strict: true` so the model's
   * output is guaranteed to conform to the JSON Schema.
   * For Anthropic, the input_schema is always passed (no strict mode available).
   */
  strictToolSchemas?: boolean;

  /**
   * Opt-in: structured response format for the final answer.
   * Maps to OpenAI `response_format: { type: "json_schema", json_schema: ... }`.
   * Ignored by providers that don't support structured response formats.
   */
  responseSchema?: ResponseSchemaConfig;
}

export interface ResponseSchemaConfig {
  /** Name for the schema (required by OpenAI). */
  name: string;
  /** JSON Schema object describing the expected response format. */
  schema: Record<string, unknown>;
  /** Optional Zod schema — if provided, its JSON Schema is derived automatically. */
  zodSchema?: ZodType;
  /** Whether the schema is strict (OpenAI default: true). */
  strict?: boolean;
}

export interface ThinkingConfig {
  /** Budget in tokens for the thinking/reasoning step. */
  budgetTokens: number;
  /**
   * OpenAI reasoning_effort mapping. Ignored for Anthropic.
   * If not set, derived from budgetTokens: <=1024 = low, <=4096 = medium, else high.
   */
  effort?: "low" | "medium" | "high";
}

/**
 * Extended LLM response with cost and thinking token accounting.
 */
export interface LLMResponseExt extends LLMResponse {
  /** Computed cost in USD based on the model's price table. Undefined if model not in table. */
  costUsd?: number;
  /** Extended token usage including thinking/reasoning tokens. */
  usage: TokenUsageExt;
}

export interface TokenUsageExt extends TokenUsage {
  /** Tokens used by thinking/reasoning (counted separately from completion). */
  thinkingTokens?: number;
  /** Tokens read from cache (subset of promptTokens, for observability). */
  cachedTokens?: number;
}

/**
 * A delta emitted during streaming. Either text content or a tool call chunk.
 */
export type StreamDelta =
  | { type: "text"; content: string }
  | { type: "tool_call"; toolCall: Partial<ToolCall> & { index: number } }
  | { type: "thinking"; content: string }
  | { type: "done"; response: LLMResponseExt };

/**
 * LLM client that supports streaming in addition to batch chat.
 */
export interface StreamableLLMClient {
  chatStream(request: LLMRequestExt): AsyncIterable<StreamDelta>;
}

/**
 * Budget cap configuration for cost tracking.
 */
export interface BudgetConfig {
  /** Maximum spend in USD. When exceeded, throws BudgetExceededError. */
  maxCostUsd: number;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly spent: number,
    public readonly limit: number,
  ) {
    super(
      `Budget exceeded: spent $${spent.toFixed(6)}, limit $${limit.toFixed(6)}`,
    );
    this.name = "BudgetExceededError";
  }
}
