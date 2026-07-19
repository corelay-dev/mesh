import type { LLMMessage } from "../llm.js";
import type { LoopStrategy, StrategyContext } from "./types.js";

const PLANNER_PROMPT = `You are a planning agent. Given the user's request, produce a numbered plan of steps to accomplish it.
Each step should be a single, concrete action. Output ONLY the plan as a numbered list (1. ... 2. ... etc).
Do not execute anything — just plan.`;

const EXECUTOR_PREFIX = `You are executing step {step} of a plan.

Full plan:
{plan}

Current step to execute: {currentStep}

Execute this step now. Use tools if needed. Respond with the result of this step only.`;

/**
 * Plan-and-Execute strategy:
 * 1. A planner call produces an ordered numbered plan.
 * 2. An executor runs each step sequentially with tool access.
 * 3. Results are accumulated and a final synthesis call produces the answer.
 */
export const planExecuteStrategy: LoopStrategy = {
  name: "plan-execute",
  async run(messages: LLMMessage[], ctx: StrategyContext): Promise<string> {
    // Step 1: Plan
    const plan = await generatePlan(messages, ctx);
    const steps = parsePlan(plan);

    if (steps.length === 0) {
      // No plan generated — fall through to direct answer
      return plan;
    }

    // Step 2: Execute each step
    const stepResults: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const stepResult = await executeStep(messages, ctx, plan, steps[i]!, i + 1, stepResults);
      stepResults.push(stepResult);
    }

    // Step 3: Synthesise final answer
    return synthesise(messages, ctx, plan, steps, stepResults);
  },
};

async function generatePlan(messages: LLMMessage[], ctx: StrategyContext): Promise<string> {
  const planMessages: LLMMessage[] = [
    { role: "system", content: PLANNER_PROMPT },
    // Include the original user message (last user message in the array)
    ...messages.filter((m) => m.role === "user"),
  ];

  const response = await ctx.llm.chat({
    messages: planMessages,
    model: ctx.model,
    maxTokens: ctx.maxTokens,
  });

  return response.content;
}

function parsePlan(plan: string): string[] {
  const lines = plan.split("\n");
  const steps: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match?.[1]) {
      steps.push(match[1].trim());
    }
  }
  return steps;
}

async function executeStep(
  originalMessages: LLMMessage[],
  ctx: StrategyContext,
  plan: string,
  currentStep: string,
  stepNumber: number,
  previousResults: string[],
): Promise<string> {
  const systemContent = EXECUTOR_PREFIX
    .replace("{step}", String(stepNumber))
    .replace("{plan}", plan)
    .replace("{currentStep}", currentStep);

  const executorMessages: LLMMessage[] = [
    { role: "system", content: systemContent },
  ];

  // Add previous step results as context
  for (let i = 0; i < previousResults.length; i++) {
    executorMessages.push({ role: "assistant", content: `Step ${i + 1} result: ${previousResults[i]}` });
  }

  executorMessages.push({ role: "user", content: `Execute step ${stepNumber}: ${currentStep}` });

  // Run a mini tool-loop for this step
  let currentMessages = [...executorMessages];
  let rounds = 0;
  const maxRoundsPerStep = Math.min(ctx.maxToolRounds, 5);

  while (rounds < maxRoundsPerStep) {
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

  return `[Step ${stepNumber} reached max rounds]`;
}

async function synthesise(
  originalMessages: LLMMessage[],
  ctx: StrategyContext,
  plan: string,
  steps: string[],
  results: string[],
): Promise<string> {
  const systemMessage = originalMessages.find((m) => m.role === "system");
  const userMessage = [...originalMessages].reverse().find((m) => m.role === "user");

  const synthesisMessages: LLMMessage[] = [
    { role: "system", content: systemMessage?.content ?? "You are a helpful assistant." },
    {
      role: "user",
      content: [
        userMessage?.content ?? "",
        "",
        "---",
        "The following plan was executed to answer the above:",
        plan,
        "",
        "Step results:",
        ...steps.map((step, i) => `${i + 1}. ${step}\n   Result: ${results[i]}`),
        "",
        "Now synthesise a final, complete answer based on the step results.",
      ].join("\n"),
    },
  ];

  const response = await ctx.llm.chat({
    messages: synthesisMessages,
    model: ctx.model,
    maxTokens: ctx.maxTokens,
  });

  return response.content;
}
