import type { LLMMessage } from "../llm.js";
import type { LoopStrategy, StrategyContext } from "./types.js";

/**
 * Default reactive loop — call LLM, execute tool calls, repeat until
 * the LLM produces a final text response or max rounds exceeded.
 * This preserves the existing behaviour when no strategy is specified.
 */
export const reactiveStrategy: LoopStrategy = {
  name: "react",
  async run(messages: LLMMessage[], ctx: StrategyContext): Promise<string> {
    let currentMessages = [...messages];
    let rounds = 0;

    while (rounds < ctx.maxToolRounds) {
      const response = await ctx.llm.chat({
        messages: currentMessages,
        model: ctx.model,
        maxTokens: ctx.maxTokens,
        tools: ctx.tools.length > 0 ? ctx.tools : undefined,
      });

      if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0 || !ctx.toolExecutor) {
        return response.content;
      }

      currentMessages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        const result = await ctx.toolExecutor.execute(call);
        currentMessages.push({
          role: "tool",
          content: result.content,
          toolCallId: result.toolCallId,
        });
      }

      rounds++;
    }

    return `[Agent reached max tool rounds (${ctx.maxToolRounds})]`;
  },
};
