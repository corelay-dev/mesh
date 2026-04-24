import { describe, it, expect } from "vitest";
import { Critic } from "@corelay/mesh-coordination";
import type { LLMClient, LLMRequest, LLMResponse } from "@corelay/mesh-core";
import { compose, createCriticAuthor, type ComposeAuthor } from "../src/index.js";

const validDraft = JSON.stringify({
  name: "triage",
  description: "First-contact triage.",
  prompt: "You are a triage assistant.",
  welcomeMessage: "Hi.",
  reviewerQuestions: ["Tone?"],
});

const revisedDraft = JSON.stringify({
  name: "triage",
  description: "First-contact triage for survivors.",
  prompt: "You are a trauma-informed first responder. Never minimise.",
  welcomeMessage: "You're safe to talk here.",
  reviewerQuestions: ["Is the child-safeguarding boundary covered?"],
});

const innerAuthor: ComposeAuthor = {
  draft: async () => validDraft,
};

/** Critic LLM that always requests a revision on the first call, then approves. */
class ReviseOnceLLM implements LLMClient {
  readonly name = "revise-once";
  calls = 0;
  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.calls++;
    const isFirstCall = this.calls === 1;
    return {
      content: isFirstCall
        ? "ISSUES:\n- Prompt is too generic. Should be trauma-informed."
        : `APPROVED`,
      model: request.model,
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    };
  }
}

/** Synthesis LLM that returns the revised draft. */
class SynthesisLLM implements LLMClient {
  readonly name = "synthesis";
  async chat(_request: LLMRequest): Promise<LLMResponse> {
    return {
      content: revisedDraft,
      model: "test",
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    };
  }
}

/** Auto-approve LLM. */
class ApproveLLM implements LLMClient {
  readonly name = "approve";
  async chat(): Promise<LLMResponse> {
    return {
      content: "APPROVED",
      model: "test",
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    };
  }
}

describe("createCriticAuthor()", () => {
  it("passes the draft through unchanged when the Critic approves", async () => {
    const critic = new Critic({
      llm: new ApproveLLM(),
      model: "test",
      domain: "safeguarding",
    });
    const author = createCriticAuthor(innerAuthor, critic);
    const output = await author.draft({ intent: "triage" });
    expect(output).toBe(validDraft);
  });

  it("returns the revised draft when the Critic requests changes", async () => {
    // The Critic uses one LLM for critique and the same for synthesis.
    // ReviseOnceLLM critiques first, then approves. SynthesisLLM produces
    // the revised content. Since Critic uses a single LLM for both, we
    // need a LLM that sequences: critique → synthesis → approve.
    let callCount = 0;
    const sequencedLLM: LLMClient = {
      name: "sequenced",
      async chat(request: LLMRequest): Promise<LLMResponse> {
        callCount++;
        let content: string;
        if (callCount === 1) {
          // First call: critique
          content = "ISSUES:\n- Too generic.";
        } else if (callCount === 2) {
          // Second call: synthesis (revision)
          content = revisedDraft;
        } else {
          // Third call: re-critique → approve
          content = "APPROVED";
        }
        return {
          content,
          model: request.model,
          toolCalls: [],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: "stop",
        };
      },
    };

    const critic = new Critic({
      llm: sequencedLLM,
      model: "test",
      domain: "safeguarding",
    });
    const author = createCriticAuthor(innerAuthor, critic);
    const output = await author.draft({ intent: "triage" });
    // The Critic revised the draft
    expect(output).toBe(revisedDraft);
  });

  it("composes end-to-end with compose()", async () => {
    const critic = new Critic({
      llm: new ApproveLLM(),
      model: "test",
      domain: "safeguarding",
    });
    const author = createCriticAuthor(innerAuthor, critic);
    const draft = await compose({ intent: "triage" }, author);
    expect(draft.config.name).toBe("triage");
  });
});
