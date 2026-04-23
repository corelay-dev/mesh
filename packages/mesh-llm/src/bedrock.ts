import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  LLMClient,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  ToolCall,
} from "@corelay/mesh-core";

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
}

/**
 * Wraps AWS Bedrock as an `LLMClient`. Day 1 scope: Anthropic Claude models
 * (`anthropic.claude-*`). Amazon Nova and other Bedrock model families can
 * be added by forking the body shape in `buildBody` / `parseResponse`.
 */
export class BedrockClient implements LLMClient {
  readonly name: string;
  private readonly client: BedrockRuntimeClient;
  private readonly defaultMaxTokens: number;

  constructor(config: BedrockClientConfig) {
    this.client = config.client;
    this.name = config.name ?? "bedrock";
    this.defaultMaxTokens = config.defaultMaxTokens ?? 1024;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    if (!request.model.startsWith("anthropic.")) {
      throw new Error(
        `BedrockClient: only anthropic.* models are supported today — got "${request.model}"`,
      );
    }

    const body = this.buildClaudeBody(request);
    const command = new InvokeModelCommand({
      modelId: request.model,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(JSON.stringify(body)),
    });

    const response = await this.client.send(command);
    const payload = JSON.parse(new TextDecoder().decode(response.body)) as ClaudeResponse;

    return this.parseClaudeResponse(payload, request.model);
  }

  private buildClaudeBody(request: LLMRequest): ClaudeRequest {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const system = systemMessages.map((m) => m.content).join("\n\n");
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map(toClaudeMessage);

    const body: ClaudeRequest = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      messages,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    return body;
  }

  private parseClaudeResponse(payload: ClaudeResponse, model: string): LLMResponse {
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

    return {
      content,
      model,
      toolCalls,
      usage: {
        promptTokens: payload.usage.input_tokens,
        completionTokens: payload.usage.output_tokens,
        totalTokens: payload.usage.input_tokens + payload.usage.output_tokens,
      },
      finishReason: toFinishReason(payload.stop_reason),
    };
  }
}

// --- Claude-on-Bedrock body/response shapes. Narrowly typed on purpose. ---

interface ClaudeRequest {
  anthropic_version: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
  temperature?: number;
  tools?: Array<{ name: string; description: string; input_schema: unknown }>;
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
  content: Array<ClaudeTextBlock | ClaudeToolUseBlock>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
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
