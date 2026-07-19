import type OpenAI from "openai";
import type {
  LLMClient,
  LLMRequest,
  LLMResponse,
  ToolCall,
} from "@corelay/mesh-core";
import type {
  LLMRequestExt,
  LLMResponseExt,
  StreamDelta,
  StreamableLLMClient,
  TokenUsageExt,
  BudgetConfig,
  ResponseSchemaConfig,
} from "./types.js";
import { BudgetExceededError } from "./types.js";
import { computeCost, BudgetTracker, type ModelPricing } from "./pricing.js";

export interface OpenAIClientConfig {
  /**
   * A pre-constructed OpenAI client. The caller imports and instantiates
   * OpenAI themselves so the sdk stays an optional peer dependency.
   */
  client: OpenAI;
  /** Logical name. Defaults to "openai". */
  name?: string;
  /** Max retries on transient errors (429, 500, 502, 503, 504). Default 3. */
  maxRetries?: number;
  /** Optional budget cap. */
  budget?: BudgetConfig;
  /** Optional custom pricing table override. */
  pricing?: Record<string, ModelPricing>;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Wraps the OpenAI SDK as an `LLMClient`. Supports plain chat, tool calls,
 * automatic retry with exponential backoff on transient errors, prompt caching,
 * cost tracking, streaming, and extended thinking/reasoning.
 */
export class OpenAIClient implements LLMClient, StreamableLLMClient {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly maxRetries: number;
  private readonly budgetTracker: BudgetTracker | undefined;
  private readonly pricing: Record<string, ModelPricing> | undefined;

  constructor(config: OpenAIClientConfig) {
    this.client = config.client;
    this.name = config.name ?? "openai";
    this.maxRetries = config.maxRetries ?? 3;
    this.budgetTracker = config.budget ? new BudgetTracker(config.budget) : undefined;
    this.pricing = config.pricing;
  }

  async chat(request: LLMRequest): Promise<LLMResponse>;
  async chat(request: LLMRequestExt): Promise<LLMResponseExt>;
  async chat(request: LLMRequest | LLMRequestExt): Promise<LLMResponse | LLMResponseExt> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }

      try {
        return await this.doChat(request as LLMRequestExt);
      } catch (err) {
        // Never retry budget errors or other non-transient application errors
        if (err instanceof BudgetExceededError) throw err;

        lastError = err instanceof Error ? err : new Error(String(err));

        const status = (err as { status?: number }).status;
        if (status && !RETRYABLE_STATUS_CODES.has(status)) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error("OpenAI: max retries exceeded");
  }

  async *chatStream(request: LLMRequestExt): AsyncIterable<StreamDelta> {
    const params = this.buildParams(request, true);
    const stream = await this.client.chat.completions.create(params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

    const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
    let content = "";
    let thinkingContent = "";

    for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        yield { type: "text", content: delta.content };
      }

      // Reasoning tokens come back in a separate field for o-series models
      const reasoning = (delta as Record<string, unknown>).reasoning_content as string | undefined;
      if (reasoning) {
        thinkingContent += reasoning;
        yield { type: "thinking", content: reasoning };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (!existing) {
            toolCalls.set(tc.index, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              args: tc.function?.arguments ?? "",
            });
          } else {
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
          }

          yield {
            type: "tool_call",
            toolCall: {
              index: tc.index,
              id: tc.id ?? existing?.id,
              name: tc.function?.name ?? existing?.name,
            },
          };
        }
      }
    }

    const parsedToolCalls: ToolCall[] = [...toolCalls.values()].map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: safeJson(tc.args),
    }));

    const usage: TokenUsageExt = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      ...(thinkingContent ? { thinkingTokens: 0 } : {}),
    };

    const response: LLMResponseExt = {
      content,
      model: request.model,
      toolCalls: parsedToolCalls,
      usage,
      finishReason: parsedToolCalls.length > 0 ? "tool_calls" : "stop",
      costUsd: undefined,
    };

    yield { type: "done", response };
  }

  private async doChat(request: LLMRequestExt): Promise<LLMResponseExt> {
    const params = this.buildParams(request, false);
    const response = await this.client.chat.completions.create(params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJson(tc.function.arguments),
      }));

    const rawUsage = response.usage;
    const thinkingTokens = rawUsage
      ? (rawUsage as unknown as Record<string, unknown>).completion_tokens_details
        ? ((rawUsage as unknown as Record<string, unknown>).completion_tokens_details as Record<string, number>)?.reasoning_tokens
        : undefined
      : undefined;
    const cachedTokens = rawUsage
      ? (rawUsage as unknown as Record<string, unknown>).prompt_tokens_details
        ? ((rawUsage as unknown as Record<string, unknown>).prompt_tokens_details as Record<string, number>)?.cached_tokens
        : undefined
      : undefined;

    const usage: TokenUsageExt = {
      promptTokens: rawUsage?.prompt_tokens ?? 0,
      completionTokens: rawUsage?.completion_tokens ?? 0,
      totalTokens: rawUsage?.total_tokens ?? 0,
      ...(thinkingTokens !== undefined && { thinkingTokens }),
      ...(cachedTokens !== undefined && { cachedTokens }),
    };

    const costUsd = computeCost(usage, response.model, this.pricing);

    if (costUsd !== undefined && this.budgetTracker) {
      this.budgetTracker.record(costUsd);
    }

    return {
      content: choice?.message.content ?? "",
      model: response.model,
      toolCalls,
      usage,
      finishReason: toFinishReason(choice?.finish_reason),
      costUsd,
    };
  }

  private buildParams(request: LLMRequestExt, stream: boolean): Record<string, unknown> {
    // For prompt caching: OpenAI caches based on prefix stability.
    // We ensure system messages + tools come first (stable prefix).
    // The SDK handles caching automatically when prefix is stable.
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCallId !== undefined && { tool_call_id: m.toolCallId }),
      ...(m.name !== undefined && { name: m.name }),
      ...(m.toolCalls?.length && {
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }),
    })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    const params: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature ?? 0.7,
      stream,
    };

    if (request.tools?.length) {
      const strict = request.strictToolSchemas === true;
      params.tools = request.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          ...(strict && { strict: true }),
        },
      }));
    }

    // Structured response format (OpenAI json_schema response_format)
    if (request.responseSchema) {
      params.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.responseSchema.name,
          schema: request.responseSchema.schema,
          strict: request.responseSchema.strict ?? true,
        },
      };
    }

    // Reasoning/extended thinking for o-series models
    if (request.thinking) {
      const effort = request.thinking.effort ?? deriveEffort(request.thinking.budgetTokens);
      params.reasoning_effort = effort;
    }

    if (stream) {
      params.stream_options = { include_usage: true };
    }

    return params;
  }
}

function deriveEffort(budgetTokens: number): "low" | "medium" | "high" {
  if (budgetTokens <= 1024) return "low";
  if (budgetTokens <= 4096) return "medium";
  return "high";
}

const safeJson = (s: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const toFinishReason = (
  reason: OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"] | undefined,
): LLMResponse["finishReason"] => {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  return "stop";
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
