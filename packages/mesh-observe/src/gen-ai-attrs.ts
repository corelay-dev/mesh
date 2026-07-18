/**
 * OpenTelemetry GenAI Semantic Conventions for Corelay Mesh spans.
 *
 * Based on OpenTelemetry Semantic Conventions for GenAI (v1.28+):
 * https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * These constants and builder functions make it easy for instrumented
 * primitives (Agent, LLM, Tool) to emit standardised attributes without
 * memorising the semconv string keys.
 */
import type { SpanAttributes } from "./tracer.js";

// ─── Attribute key constants ───────────────────────────────────────────

/** The GenAI system (e.g. "openai", "anthropic", "bedrock"). */
export const GEN_AI_SYSTEM = "gen_ai.system" as const;

/** The model requested (e.g. "gpt-4o", "claude-sonnet-4-20250514"). */
export const GEN_AI_REQUEST_MODEL = "gen_ai.request.model" as const;

/** The operation being performed (e.g. "chat", "embeddings", "tool_call"). */
export const GEN_AI_OPERATION_NAME = "gen_ai.operation.name" as const;

/** Maximum tokens the model should generate. */
export const GEN_AI_REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens" as const;

/** Temperature setting for the request. */
export const GEN_AI_REQUEST_TEMPERATURE =
  "gen_ai.request.temperature" as const;

/** Top-P setting for the request. */
export const GEN_AI_REQUEST_TOP_P = "gen_ai.request.top_p" as const;

/** Number of input tokens consumed. */
export const GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens" as const;

/** Number of output tokens generated. */
export const GEN_AI_USAGE_OUTPUT_TOKENS =
  "gen_ai.usage.output_tokens" as const;

/** Total tokens (input + output) if reported by the provider. */
export const GEN_AI_USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens" as const;

/** The finish reason reported by the model (e.g. "stop", "length", "tool_calls"). */
export const GEN_AI_RESPONSE_FINISH_REASON =
  "gen_ai.response.finish_reason" as const;

/** The model that actually served the request (may differ from request.model). */
export const GEN_AI_RESPONSE_MODEL = "gen_ai.response.model" as const;

/** The response ID from the provider. */
export const GEN_AI_RESPONSE_ID = "gen_ai.response.id" as const;

/** Tool call function name. */
export const GEN_AI_TOOL_NAME = "gen_ai.tool.name" as const;

/** Tool call description. */
export const GEN_AI_TOOL_DESCRIPTION = "gen_ai.tool.description" as const;

// ─── Builder types ─────────────────────────────────────────────────────

/** Input for building GenAI request attributes. */
export interface GenAiRequestInput {
  system: string;
  model: string;
  operationName: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

/** Input for building GenAI response/usage attributes. */
export interface GenAiResponseInput {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  responseModel?: string;
  responseId?: string;
}

/** Input for building tool-call attributes. */
export interface GenAiToolInput {
  system: string;
  toolName: string;
  toolDescription?: string;
  model?: string;
}

// ─── Builder functions ─────────────────────────────────────────────────

/**
 * Build span attributes for a GenAI request (LLM/chat call start).
 * All returned keys follow the OTel GenAI semantic conventions.
 */
export const genAiRequestAttrs = (input: GenAiRequestInput): SpanAttributes => {
  const attrs: SpanAttributes = {
    [GEN_AI_SYSTEM]: input.system,
    [GEN_AI_REQUEST_MODEL]: input.model,
    [GEN_AI_OPERATION_NAME]: input.operationName,
  };
  if (input.maxTokens !== undefined)
    attrs[GEN_AI_REQUEST_MAX_TOKENS] = input.maxTokens;
  if (input.temperature !== undefined)
    attrs[GEN_AI_REQUEST_TEMPERATURE] = input.temperature;
  if (input.topP !== undefined) attrs[GEN_AI_REQUEST_TOP_P] = input.topP;
  return attrs;
};

/**
 * Build span attributes for a GenAI response/usage (set after LLM returns).
 * Intended to be passed to `ctx.setAttributes(...)` inside the span body.
 */
export const genAiResponseAttrs = (
  input: GenAiResponseInput,
): SpanAttributes => {
  const attrs: SpanAttributes = {};
  if (input.inputTokens !== undefined)
    attrs[GEN_AI_USAGE_INPUT_TOKENS] = input.inputTokens;
  if (input.outputTokens !== undefined)
    attrs[GEN_AI_USAGE_OUTPUT_TOKENS] = input.outputTokens;
  if (input.totalTokens !== undefined)
    attrs[GEN_AI_USAGE_TOTAL_TOKENS] = input.totalTokens;
  if (input.finishReason !== undefined)
    attrs[GEN_AI_RESPONSE_FINISH_REASON] = input.finishReason;
  if (input.responseModel !== undefined)
    attrs[GEN_AI_RESPONSE_MODEL] = input.responseModel;
  if (input.responseId !== undefined)
    attrs[GEN_AI_RESPONSE_ID] = input.responseId;
  return attrs;
};

/**
 * Build span attributes for a GenAI tool call.
 */
export const genAiToolAttrs = (input: GenAiToolInput): SpanAttributes => {
  const attrs: SpanAttributes = {
    [GEN_AI_SYSTEM]: input.system,
    [GEN_AI_OPERATION_NAME]: "tool_call",
    [GEN_AI_TOOL_NAME]: input.toolName,
  };
  if (input.model !== undefined) attrs[GEN_AI_REQUEST_MODEL] = input.model;
  if (input.toolDescription !== undefined)
    attrs[GEN_AI_TOOL_DESCRIPTION] = input.toolDescription;
  return attrs;
};
