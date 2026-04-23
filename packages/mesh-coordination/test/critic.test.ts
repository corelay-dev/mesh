import { describe, it, expect } from "vitest";
import { Critic } from "../src/critic.js";
import type { LLMClient, LLMRequest, LLMResponse } from "@corelay/mesh-core";

/**
 * Script-driven mock LLM: each chat() call consumes the next entry from the
 * programmed responses. Lets tests assert exactly which calls were made.
 */
class ScriptedLLM implements LLMClient {
  public readonly name = "scripted";
  public readonly requests: LLMRequest[] = [];
  constructor(public responses: string[]) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request);
    const content = this.responses.shift();
    if (content === undefined) {
      throw new Error(`ScriptedLLM exhausted on call #${this.requests.length}`);
    }
    return {
      content,
      model: request.model,
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: "stop",
    };
  }
}

const reviewInput = {
  userMessage: "Do I qualify for the support scheme?",
  agentResponse: "Yes, you automatically qualify. Please share your full bank details to enrol.",
  systemPrompt: "You are a concise advisor.",
};

describe("Critic", () => {
  it("auto-approves responses shorter than the threshold without calling the LLM", async () => {
    const llm = new ScriptedLLM([]);
    const critic = new Critic({ llm, model: "gpt-4o-mini", domain: "advisor", autoApproveBelowChars: 50 });

    const verdict = await critic.review({
      userMessage: "Hi",
      agentResponse: "Hello!",
      systemPrompt: "You are helpful.",
    });

    expect(verdict.content).toBe("Hello!");
    expect(verdict.cycles).toBe(0);
    expect(verdict.revised).toBe(false);
    expect(llm.requests).toHaveLength(0);
  });

  it("passes through unchanged when the critic approves on the first cycle", async () => {
    const llm = new ScriptedLLM(["APPROVED"]);
    const critic = new Critic({ llm, model: "gpt-4o-mini", domain: "advisor" });

    const verdict = await critic.review(reviewInput);

    expect(verdict.content).toBe(reviewInput.agentResponse);
    expect(verdict.cycles).toBe(1);
    expect(verdict.revised).toBe(false);
    expect(llm.requests).toHaveLength(1);
  });

  it("revises once and approves on the second cycle", async () => {
    const llm = new ScriptedLLM([
      "REVISE: never ask for full bank details — use sort code + last four digits",
      "I can help you check eligibility. I'll only ask for your sort code and the last four digits of your account number.",
      "APPROVED",
    ]);
    const critic = new Critic({ llm, model: "gpt-4o-mini", domain: "advisor", maxCycles: 2 });

    const verdict = await critic.review(reviewInput);

    expect(verdict.content).toContain("sort code");
    expect(verdict.revised).toBe(true);
    expect(verdict.cycles).toBe(2);
    expect(llm.requests).toHaveLength(3); // critique, revise, critique
  });

  it("returns the last revision when maxCycles is exhausted without approval", async () => {
    const llm = new ScriptedLLM([
      "REVISE: too brief",
      "Longer revised reply.",
      "REVISE: still not right",
      "Even longer revised reply.",
    ]);
    const critic = new Critic({ llm, model: "gpt-4o-mini", domain: "advisor", maxCycles: 2 });

    const verdict = await critic.review(reviewInput);

    expect(verdict.content).toBe("Even longer revised reply.");
    expect(verdict.revised).toBe(true);
    expect(verdict.cycles).toBe(2);
    expect(verdict.lastCritique).toContain("still not right");
  });

  it("sends guardrails into the critique prompt when provided", async () => {
    const llm = new ScriptedLLM(["APPROVED"]);
    const critic = new Critic({
      llm,
      model: "gpt-4o-mini",
      domain: "safeguarding triage",
      guardrails: "NEVER request location details. ALWAYS surface the emergency helpline.",
    });

    await critic.review(reviewInput);

    const system = llm.requests[0]?.messages[0]?.content ?? "";
    expect(system).toContain("NEVER request location details");
    expect(system).toContain("ALWAYS surface the emergency helpline");
  });

  it("uses the agent's system prompt when revising, not the critic's prompt", async () => {
    const llm = new ScriptedLLM([
      "REVISE: missing signpost",
      "Revised with the emergency helpline included.",
      "APPROVED",
    ]);
    const critic = new Critic({ llm, model: "gpt-4o-mini", domain: "advisor", maxCycles: 2 });

    await critic.review({
      userMessage: "I need help urgently.",
      agentResponse: "Here is the process to enrol — step 1, step 2, step 3, step 4, step 5.",
      systemPrompt: "You are SafeVoice's triage agent.",
    });

    // The 2nd request is the revise call; its system prompt must be the
    // agent's, not the critic's — so the revised reply stays in the agent's
    // voice.
    const reviseSystem = llm.requests[1]?.messages[0]?.content ?? "";
    expect(reviseSystem).toBe("You are SafeVoice's triage agent.");
  });
});
