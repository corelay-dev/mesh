import type { LLMMessage } from "../llm.js";
import type { LoopStrategy, StrategyContext } from "./types.js";

const REACT_SYSTEM_SUFFIX = `\n\nIMPORTANT: Before taking any action or making tool calls, always output your reasoning as a "Thought:" block. Explain what you know, what you need to find out, and what action you'll take next. Then proceed with the action.`;

/**
 * ReAct strategy — interleaves an explicit reasoning/thought step before
 * each action round. The LLM is prompted to produce a "Thought:" before
 * tool calls. The thought is preserved in conversation for the next round
 * but stripped from the final answer.
 */
export const reactStrategy: LoopStrategy = {
  name: "react",
  async run(messages: LLMMessage[], ctx: StrategyContext): Promise<string> {
    // Augment system prompt with ReAct instruction
    const augmented = injectReActPrompt(messages);
    let currentMessages = [...augmented];
    let rounds = 0;

    while (rounds < ctx.maxToolRounds) {
      const response = await ctx.llm.chat({
        messages: currentMessages,
        model: ctx.model,
        maxTokens: ctx.maxTokens,
        tools: ctx.tools.length > 0 ? ctx.tools : undefined,
      });

      // No tool calls — final answer. Strip any residual "Thought:" prefix.
      if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0 || !ctx.toolExecutor) {
        return stripThoughtPrefix(response.content);
      }

      // Keep the full response (thought + tool_calls) in the conversation
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

function injectReActPrompt(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((m, i) => {
    if (i === 0 && m.role === "system") {
      return { ...m, content: m.content + REACT_SYSTEM_SUFFIX };
    }
    return m;
  });
}

function stripThoughtPrefix(content: string): string {
  // Remove leading "Thought: ..." block (up to "Action:" or "Answer:" or end of thought)
  const thoughtPattern = /^Thought:.*?(?=\n(?:Action|Answer|Final Answer):|\n\n)/s;
  const stripped = content.replace(thoughtPattern, "").trim();
  return stripped || content;
}
