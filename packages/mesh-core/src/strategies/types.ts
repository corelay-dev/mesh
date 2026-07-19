import type { LLMClient, LLMMessage, LLMResponse } from "../llm.js";
import type { ToolDefinition, ToolCall } from "../tool.js";
import type { ToolExecutor } from "../tool-executor.js";

/**
 * Supported loop strategy names. undefined = default reactive loop.
 */
export type StrategyName = "react" | "plan-execute" | "reflexion";

/**
 * Configuration passed to a strategy's run function.
 */
export interface StrategyContext {
  llm: LLMClient;
  model: string;
  maxTokens: number;
  tools: ToolDefinition[];
  toolExecutor: ToolExecutor | undefined;
  maxToolRounds: number;
  systemPrompt: string;
}

/**
 * A strategy is a function that drives the LLM loop to produce a final text answer.
 * It receives the current messages (including system + history + user) and context.
 */
export interface LoopStrategy {
  readonly name: StrategyName;
  run(messages: LLMMessage[], ctx: StrategyContext): Promise<string>;
}
