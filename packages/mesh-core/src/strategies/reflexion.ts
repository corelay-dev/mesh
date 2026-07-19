import type { LLMMessage } from "../llm.js";
import type { LoopStrategy, StrategyContext } from "./types.js";

export interface ReflexionConfig {
  /** Max self-critique cycles. Default 2. */
  maxReflections?: number;
  /** Responses shorter than this skip reflexion. Default 50. */
  autoApproveBelowChars?: number;
}

const CRITIQUE_PROMPT = `You are a self-critic reviewing your own response. Evaluate it for:
1. Correctness — are all claims accurate?
2. Completeness — does it fully address the question?
3. Clarity — is it clear and well-structured?
4. Safety — does it avoid harmful content?

If the response is acceptable, respond with exactly: APPROVED
If it needs improvement, respond with: REVISE: <specific issue to fix>`;

/**
 * Reflexion strategy:
 * 1. Runs the normal reactive tool-calling loop to produce a candidate answer.
 * 2. Runs an in-loop self-critique (separate LLM call) on the candidate.
 * 3. If critique says REVISE, re-generates incorporating the feedback.
 * 4. Repeats up to maxReflections times, then returns the last version.
 *
 * This is distinct from the post-hoc ResponseReviewer — it happens inside the
 * agent loop before the response is finalized, allowing self-correction with
 * access to the full conversation context.
 */
export class ReflexionStrategy implements LoopStrategy {
  readonly name = "reflexion" as const;
  private readonly maxReflections: number;
  private readonly autoApproveBelowChars: number;

  constructor(config: ReflexionConfig = {}) {
    this.maxReflections = config.maxReflections ?? 2;
    this.autoApproveBelowChars = config.autoApproveBelowChars ?? 50;
  }

  async run(messages: LLMMessage[], ctx: StrategyContext): Promise<string> {
    // Step 1: Generate candidate via reactive loop
    let candidate = await this.reactiveLoop(messages, ctx);

    // Short responses skip reflexion
    if (candidate.length < this.autoApproveBelowChars) {
      return candidate;
    }

    // Step 2: Self-critique loop
    for (let cycle = 0; cycle < this.maxReflections; cycle++) {
      const critique = await this.selfCritique(messages, candidate, ctx);

      if (critique.trim().startsWith("APPROVED")) {
        return candidate;
      }

      // Extract the issue
      const issue = critique.replace(/^REVISE:\s*/i, "").trim();

      // Step 3: Revise incorporating feedback
      candidate = await this.revise(messages, candidate, issue, ctx);
    }

    return candidate;
  }

  private async reactiveLoop(messages: LLMMessage[], ctx: StrategyContext): Promise<string> {
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
  }

  private async selfCritique(
    originalMessages: LLMMessage[],
    candidate: string,
    ctx: StrategyContext,
  ): Promise<string> {
    const userMessage = [...originalMessages].reverse().find((m) => m.role === "user");
    const critiqueMessages: LLMMessage[] = [
      { role: "system", content: CRITIQUE_PROMPT },
      {
        role: "user",
        content: `User asked: "${userMessage?.content ?? ""}"\n\nYour response: "${candidate}"`,
      },
    ];

    const response = await ctx.llm.chat({
      messages: critiqueMessages,
      model: ctx.model,
      maxTokens: 300,
    });

    return response.content;
  }

  private async revise(
    originalMessages: LLMMessage[],
    candidate: string,
    issue: string,
    ctx: StrategyContext,
  ): Promise<string> {
    const systemMessage = originalMessages.find((m) => m.role === "system");
    const userMessage = [...originalMessages].reverse().find((m) => m.role === "user");

    const revisionMessages: LLMMessage[] = [
      { role: "system", content: systemMessage?.content ?? "You are a helpful assistant." },
      { role: "user", content: userMessage?.content ?? "" },
      { role: "assistant", content: candidate },
      {
        role: "user",
        content: `Self-review found this issue: "${issue}". Provide a corrected response addressing the concern. Return ONLY the corrected response.`,
      },
    ];

    const response = await ctx.llm.chat({
      messages: revisionMessages,
      model: ctx.model,
      maxTokens: ctx.maxTokens,
    });

    return response.content;
  }
}

/** Convenience factory with default config. */
export const reflexionStrategy = new ReflexionStrategy();
