import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
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

export interface BedrockClientConfig {
  /**
   * A pre-constructed Bedrock runtime client. Keeps the aws-sdk an optional
   * peer dependency.
   */
  client: BedrockRuntimeClient;
  /** Logical name. Defaults to "bedrock". */
  name?: string;
  /**
   * Default max_tokens when the request doesn't specify one. Anthropic via
   * Bedrock requires max_tokens. Defaults to 1024.
   */
  defaultMaxTokens?: number;
  /** Optional budget cap. */
  budget?: BudgetConfig;
  /** Optional custom pricing table override. */
  pricing?: Record<string, ModelPricing>;
}

/**
 * Wraps AWS Bedrock as an `LLMClient`. Day 1 scope: Anthropic Claude models
 * (`anthropic.claude-*`). Supports prompt caching, cost tracking, streaming
 * (InvokeModelWithResponseStream), and extended thinking.
 */
export class BedrockClient implements LLMClient, StreamableLLMClient {
  readonly name: string;
  private readonly client: BedrockRuntimeClient;
  private readonly defaultMaxTokens: number;
  private readonly budgetTracker: BudgetTracker | undefined;
  private readonly pricing: Record<string, ModelPricing> | undefined;

  constructor(config: BedrockClientConfig) {
    this.client = config.client;
    this.name = config.name ?? "bedrock";
    this.defaultMaxTokens = config.defaultMaxTokens ?? 1024;
    this.budgetTracker = config.budget ? new BudgetTracker(config.budget) : undefined;
    this.pricing = config.pricing;
  }

  async chat(request: LLMRequest): Promise<LLMResponse>;
  async chat(request: LLMRequestExt): Promise<LLMResponseExt>;
  async chat(request: LLMRequest | LLMRequestExt): Promise<LLMResponse | LLMResponseExt> {
    const extRequest = request as LLMRequestExt;
    if (!request.model.startsWith("anthropic.")) {
      throw new Error(
        `BedrockClient: only anthropic.* models are supported today — got "${request.model}"`,
      );
    }

    const body = this.buildClaudeBody(extRequest);
    const command = new InvokeModelCommand({
      modelId: request.model,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(JSON.stringify(body)),
    });

    const response = await this.client.send(command);
    const payload = JSON.parse(new TextDecoder().decode(response.body)) as ClaudeResponse;

    return this.parseClaudeResponse(payload, request.model, extRequest);
  }

  async *chatStream(request: LLMRequestExt): AsyncIterable<StreamDelta> {
    if (!request.model.startsWith("anthropic.")) {
      throw new Error(
        `BedrockClient: only anthropic.* models are supported today — got "${request.model}"`,
      );
    }

    const body = this.buildClaudeBody(request);
    const command = new InvokeModelWithResponseStreamCommand({
      modelId: request.model,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(JSON.stringify(body)),
    });

    const response = await this.client.send(command);
    const stream = response.body;
    if (!stream) {
      throw new Error("BedrockClient: no response stream body");
    }

    let content = "";
    let thinkingContent = "";
    const toolUseBlocks: Map<number, { id: string; name: string; input: string }> = new Map();
    let blockIndex = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream as AsyncIterable<BedrockStreamEvent>) {
      const chunk = event.chunk;
      if (!chunk?.bytes) continue;
      const data = JSON.parse(new TextDecoder().decode(chunk.bytes)) as StreamChunk;

      switch (data.type) {
        case "message_start":
          inputTokens = data.message?.usage?.input_tokens ?? 0;
          break;

        case "content_block_start":
          blockIndex = data.index ?? blockIndex;
          if (data.content_block?.type === "tool_use") {
            toolUseBlocks.set(blockIndex, {
              id: data.content_block.id ?? "",
              name: data.content_block.name ?? "",
              input: "",
            });
          }
          break;

        case "content_block_delta":
          if (data.delta?.type === "text_delta" && data.delta.text) {
            content += data.delta.text;
            yield { type: "text", content: data.delta.text };
          } else if (data.delta?.type === "thinking_delta" && data.delta.thinking) {
            thinkingContent += data.delta.thinking;
            yield { type: "thinking", content: data.delta.thinking };
          } else if (data.delta?.type === "input_json_delta" && data.delta.partial_json) {
            const block = toolUseBlocks.get(data.index ?? blockIndex);
            if (block) {
              block.input += data.delta.partial_json;
              yield {
                type: "tool_call",
                toolCall: { index: data.index ?? blockIndex, id: block.id, name: block.name },
              };
            }
          }
          break;

        case "message_delta":
          outputTokens = data.usage?.output_tokens ?? outputTokens;
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

    const finalResponse: LLMResponseExt = {
      content,
      model: request.model,
      toolCalls: parsedToolCalls,
      usage,
      finishReason: parsedToolCalls.length > 0 ? "tool_calls" : "stop",
      costUsd,
    };

    yield { type: "done", response: finalResponse };
  }

  private buildClaudeBody(request: LLMRequestExt): ClaudeRequest {
    const enableCaching = request.enablePromptCaching === true;
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map(toClaudeMessage);

    const body: ClaudeRequest = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      messages,
    };

    if (systemMessages.length > 0) {
      if (enableCaching) {
        body.system = systemMessages.map((m, i) => ({
          type: "text" as const,
          text: m.content,
          ...(i === systemMessages.length - 1 && { cache_control: { type: "ephemeral" } }),
        }));
      } else {
        body.system = systemMessages.map((m) => m.content).join("\n\n");
      }
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;

    if (request.tools?.length) {
      body.tools = request.tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
        ...(enableCaching && i === request.tools!.length - 1 && {
          cache_control: { type: "ephemeral" },
        }),
      }));
    }

    // Extended thinking
    if (request.thinking) {
      body.thinking = {
        type: "enabled",
        budget_tokens: request.thinking.budgetTokens,
      };
      body.temperature = 1;
    }

    return body;
  }

  private parseClaudeResponse(
    payload: ClaudeResponse,
    model: string,
    request: LLMRequestExt,
  ): LLMResponseExt {
    const content = payload.content
      .filter((b): b is ClaudeTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const toolCalls: ToolCall[] = payload.content
      .filter((b): b is ClaudeToolUseBlock => b.type === "tool_use")
      .map((b) => ({
        id: b.id,
        name: b.name,
        arguments: (b.input as Record<string, unknown>) ?? {},
      }));

    // Extract thinking tokens if present
    const thinkingBlocks = payload.content.filter(
      (b) => (b as Record<string, unknown>).type === "thinking",
    );
    const thinkingTokens = thinkingBlocks.length > 0
      ? (payload.usage as Record<string, number>).thinking_tokens
      : undefined;

    const cachedTokens = (payload.usage as Record<string, number>).cache_read_input_tokens;

    const usage: TokenUsageExt = {
      promptTokens: payload.usage.input_tokens,
      completionTokens: payload.usage.output_tokens,
      totalTokens: payload.usage.input_tokens + payload.usage.output_tokens,
      ...(thinkingTokens !== undefined && { thinkingTokens }),
      ...(cachedTokens !== undefined && { cachedTokens }),
    };

    const costUsd = computeCost(usage, model, this.pricing);

    if (costUsd !== undefined && this.budgetTracker) {
      this.budgetTracker.record(costUsd);
    }

    return {
      content,
      model,
      toolCalls,
      usage,
      finishReason: toFinishReason(payload.stop_reason),
      costUsd,
    };
  }
}

// --- Claude-on-Bedrock body/response shapes ---

interface ClaudeRequest {
  anthropic_version: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string | Array<{ type: "text"; text: string; cache_control?: { type: string } }>;
  temperature?: number;
  tools?: Array<{ name: string; description: string; input_schema: unknown; cache_control?: { type: string } }>;
  thinking?: { type: string; budget_tokens: number };
}

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ClaudeTextBlock {
  type: "text";
  text: string;
}

interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

interface ClaudeResponse {
  content: Array<ClaudeTextBlock | ClaudeToolUseBlock | { type: string }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

interface BedrockStreamEvent {
  chunk?: { bytes?: Uint8Array };
}

interface StreamChunk {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
  usage?: { output_tokens?: number };
}

const toClaudeMessage = (m: LLMMessage): ClaudeMessage => {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content },
      ],
    };
  }
  return {
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  };
};

const toFinishReason = (reason: string): LLMResponse["finishReason"] => {
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
