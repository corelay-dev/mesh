import type Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  LLMMessage,
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
} from "./types.js";
import { computeCost, BudgetTracker, type ModelPricing } from "./pricing.js";

export interface AnthropicClientConfig {
  /**
   * A pre-constructed Anthropic client. Keeps the sdk an optional peer dep.
   */
  client: Anthropic;
  /** Logical name. Defaults to "anthropic". */
  name?: string;
  /**
   * Default max_tokens when the request doesn't specify one.
   * Anthropic requires max_tokens on every call. Defaults to 1024.
   */
  defaultMaxTokens?: number;
  /** Optional budget cap. */
  budget?: BudgetConfig;
  /** Optional custom pricing table override. */
  pricing?: Record<string, ModelPricing>;
}

/**
 * Wraps the Anthropic SDK as an `LLMClient`. Translates the platform's
 * unified message/tool schema to Anthropic's format and back. Supports
 * prompt caching, cost tracking, streaming, and extended thinking.
 */
export class AnthropicClient implements LLMClient, StreamableLLMClient {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly defaultMaxTokens: number;
  private readonly budgetTracker: BudgetTracker | undefined;
  private readonly pricing: Record<string, ModelPricing> | undefined;

  constructor(config: AnthropicClientConfig) {
    this.client = config.client;
    this.name = config.name ?? "anthropic";
    this.defaultMaxTokens = config.defaultMaxTokens ?? 1024;
    this.budgetTracker = config.budget ? new BudgetTracker(config.budget) : undefined;
    this.pricing = config.pricing;
  }

  async chat(request: LLMRequest): Promise<LLMResponse>;
  async chat(request: LLMRequestExt): Promise<LLMResponseExt>;
  async chat(request: LLMRequest | LLMRequestExt): Promise<LLMResponse | LLMResponseExt> {
    const extRequest = request as LLMRequestExt;
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const messages = request.messages.filter((m) => m.role !== "system");

    const params = this.buildParams(extRequest, systemMessages, messages);
    const response = await this.client.messages.create(params as unknown as Anthropic.MessageCreateParams);

    return this.parseResponse(response as Anthropic.Message, extRequest);
  }

  async *chatStream(request: LLMRequestExt): AsyncIterable<StreamDelta> {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const messages = request.messages.filter((m) => m.role !== "system");

    const params = this.buildParams(request, systemMessages, messages);
    params.stream = true;

    const stream = await this.client.messages.create(params as unknown as Anthropic.MessageCreateParams & { stream: true });

    let content = "";
    let thinkingContent = "";
    const toolUseBlocks: Map<number, { id: string; name: string; input: string }> = new Map();
    let blockIndex = 0;
    let currentBlockType: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream as AsyncIterable<AnthropicStreamEvent>) {
      switch (event.type) {
        case "message_start":
          inputTokens = event.message?.usage?.input_tokens ?? 0;
          break;

        case "content_block_start":
          blockIndex = event.index ?? blockIndex;
          if (event.content_block?.type === "tool_use") {
            toolUseBlocks.set(blockIndex, {
              id: event.content_block.id ?? "",
              name: event.content_block.name ?? "",
              input: "",
            });
            currentBlockType = "tool_use";
          } else if (event.content_block?.type === "thinking") {
            currentBlockType = "thinking";
          } else {
            currentBlockType = "text";
          }
          break;

        case "content_block_delta":
          if (event.delta?.type === "text_delta" && event.delta.text) {
            content += event.delta.text;
            yield { type: "text", content: event.delta.text };
          } else if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
            thinkingContent += event.delta.thinking;
            yield { type: "thinking", content: event.delta.thinking };
          } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
            const block = toolUseBlocks.get(event.index ?? blockIndex);
            if (block) {
              block.input += event.delta.partial_json;
              yield {
                type: "tool_call",
                toolCall: { index: event.index ?? blockIndex, id: block.id, name: block.name },
              };
            }
          }
          break;

        case "message_delta":
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          break;
      }
    }

    const parsedToolCalls: ToolCall[] = [...toolUseBlocks.values()].map((b) => ({
      id: b.id,
      name: b.name,
      arguments: safeJson(b.input),
    }));

    const usage: TokenUsageExt = {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
      ...(thinkingContent ? { thinkingTokens: 0 } : {}),
    };

    const costUsd = computeCost(usage, request.model, this.pricing);

    const response: LLMResponseExt = {
      content,
      model: request.model,
      toolCalls: parsedToolCalls,
      usage,
      finishReason: parsedToolCalls.length > 0 ? "tool_calls" : "stop",
      costUsd,
    };

    yield { type: "done", response };
  }

  private buildParams(
    request: LLMRequestExt,
    systemMessages: LLMMessage[],
    messages: LLMMessage[],
  ): Record<string, unknown> {
    const enableCaching = request.enablePromptCaching === true;

    // Build system param — with cache_control breakpoints if caching enabled
    let system: unknown = undefined;
    if (systemMessages.length > 0) {
      if (enableCaching) {
        // Use structured system blocks with cache_control on the last system block
        const systemBlocks = systemMessages.map((m, i) => ({
          type: "text" as const,
          text: m.content,
          ...(i === systemMessages.length - 1 && { cache_control: { type: "ephemeral" } }),
        }));
        system = systemBlocks;
      } else {
        system = systemMessages.map((m) => m.content).join("\n\n");
      }
    }

    const params: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      messages: messages.map(toAnthropicMessage) as Anthropic.MessageParam[],
    };

    if (system !== undefined) {
      params.system = system;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.tools?.length) {
      const tools = request.tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool.InputSchema,
        // Cache control on last tool definition for prompt caching
        ...(enableCaching && i === request.tools!.length - 1 && {
          cache_control: { type: "ephemeral" },
        }),
      }));
      params.tools = tools;
    }

    // Extended thinking
    if (request.thinking) {
      params.thinking = {
        type: "enabled",
        budget_tokens: request.thinking.budgetTokens,
      };
      // Extended thinking requires temperature to be 1 (Anthropic constraint)
      params.temperature = 1;
    }

    return params;
  }

  private parseResponse(response: Anthropic.Message, request: LLMRequestExt): LLMResponseExt {
    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({
        id: b.id,
        name: b.name,
        arguments: (b.input as Record<string, unknown>) ?? {},
      }));

    // Extract thinking tokens if present
    const thinkingBlocks = response.content.filter(
      (b) => (b as unknown as Record<string, unknown>).type === "thinking",
    );
    const thinkingTokens = thinkingBlocks.length > 0
      ? (response.usage as unknown as Record<string, unknown>).thinking_tokens as number | undefined
      : undefined;

    // Extract cache metrics
    const cacheRead = (response.usage as unknown as Record<string, number>).cache_read_input_tokens;
    const cachedTokens = cacheRead !== undefined ? cacheRead : undefined;

    const usage: TokenUsageExt = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      ...(thinkingTokens !== undefined && { thinkingTokens }),
      ...(cachedTokens !== undefined && { cachedTokens }),
    };

    const costUsd = computeCost(usage, response.model, this.pricing);

    if (costUsd !== undefined && this.budgetTracker) {
      this.budgetTracker.record(costUsd);
    }

    return {
      content,
      model: response.model,
      toolCalls,
      usage,
      finishReason: toFinishReason(response.stop_reason),
      costUsd,
    };
  }
}

// Stream event types (narrowly typed for our usage)
interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string; text?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  usage?: { output_tokens?: number };
}

const toAnthropicMessage = (m: LLMMessage): Anthropic.MessageParam => {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.toolCallId ?? "",
          content: m.content,
        },
      ],
    };
  }
  return {
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  };
};

const toFinishReason = (
  reason: Anthropic.Message["stop_reason"],
): LLMResponse["finishReason"] => {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "stop";
};

const safeJson = (s: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};
