import type OpenAI from "openai";
import type {
  LLMClient,
  LLMRequest,
  LLMResponse,
  ToolCall,
} from "@corelay/mesh-core";

export interface OpenAIClientConfig {
  /**
   * A pre-constructed OpenAI client. The caller imports and instantiates
   * OpenAI themselves so the sdk stays an optional peer dependency.
   */
  client: OpenAI;
  /** Logical name. Defaults to "openai". */
  name?: string;
}

/**
 * Wraps the OpenAI SDK as an `LLMClient`. Supports plain chat and tool calls.
 */
export class OpenAIClient implements LLMClient {
  readonly name: string;
  private readonly client: OpenAI;

  constructor(config: OpenAIClientConfig) {
    this.client = config.client;
    this.name = config.name ?? "openai";
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId !== undefined && { tool_call_id: m.toolCallId }),
        ...(m.name !== undefined && { name: m.name }),
      })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens,
      temperature: request.temperature ?? 0.7,
      ...(request.tools?.length && {
        tools: request.tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      }),
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJson(tc.function.arguments),
      }));

    return {
      content: choice?.message.content ?? "",
      model: response.model,
      toolCalls,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: toFinishReason(choice?.finish_reason),
    };
  }
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
