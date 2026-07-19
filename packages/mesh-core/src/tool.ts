import type { ZodType } from "zod";

/**
 * A Tool is a named function an Agent can invoke to take action in the world
 * or fetch information.
 *
 * A tool declaration describes the function's shape to the LLM. Execution is
 * handled separately by a ToolExecutor (added in a later commit).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  parameters: Record<string, unknown>;
  /**
   * Optional Zod schema for runtime validation of tool arguments.
   * When present, the tool executor validates model-generated arguments
   * before execution, returning a typed error on validation failure.
   * The existing `parameters` JSON Schema field remains the source of truth
   * for LLM-facing schema; this is for runtime enforcement only.
   */
  schema?: ZodType;
}

/**
 * An invocation of a tool by the LLM.
 */
export interface ToolCall {
  /** LLM-assigned id, used to pair a call with its result. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * The result of executing a tool call.
 */
export interface ToolResult {
  /** Matches the ToolCall.id. */
  toolCallId: string;
  /** String result — structured data can be JSON-encoded. */
  content: string;
  /** True if the tool returned an error. */
  error?: boolean;
}
