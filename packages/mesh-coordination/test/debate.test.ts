import { describe, it, expect } from "vitest";
import type { LLMClient, LLMRequest, LLMResponse } from "@corelay/mesh-core";
import { runDebate, type DebateParticipant } from "../src/index.js";

class ScriptedLLM implements LLMClient {
  readonly name: string;
  calls = 0;
  lastRequest?: LLMRequest;
  constructor(
    readonly replies: ReadonlyArray<string>,
    name = "scripted",
  ) {
    this.name = name;
  }
  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.lastRequest = request;
    const reply = this.replies[this.calls] ?? this.replies[this.replies.length - 1] ?? "";
    this.calls++;
    return {
      content: reply,
      model: request.model,
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    };
  }
}

const pro = (llm: LLMClient): DebateParticipant => ({
  name: "pro",
  stance: "Argue in favour.",
  llm,
  model: "test",
});

const con = (llm: LLMClient): DebateParticipant => ({
  name: "con",
  stance: "Argue against.",
  llm,
  model: "test",
});

describe("runDebate — structure", () => {
  it("throws when fewer than two participants are supplied", async () => {
    const llm = new ScriptedLLM(["x"]);
    await expect(
      runDebate({
        topic: "t",
        participants: [pro(llm)],
        judge: { kind: "rule", decide: () => ({ verdict: "a", rationale: "b" }) },
      }),
    ).rejects.toThrow("two");
  });

  it("runs the specified number of rounds, each participant once", async () => {
    const llm = new ScriptedLLM(["p1", "c1", "p2", "c2"]);
    const result = await runDebate({
      topic: "Should we ship it?",
      participants: [pro(llm), con(llm)],
      judge: { kind: "rule", decide: () => ({ verdict: "ship", rationale: "pro wins" }) },
      rounds: 2,
    });
    expect(result.rounds).toBe(2);
    expect(result.exchange).toHaveLength(4);
    expect(result.exchange[0]).toMatchObject({ round: 1, participant: "pro" });
    expect(result.exchange[1]).toMatchObject({ round: 1, participant: "con" });
    expect(result.exchange[2]).toMatchObject({ round: 2, participant: "pro" });
    expect(result.exchange[3]).toMatchObject({ round: 2, participant: "con" });
  });

  it("defaults to two rounds", async () => {
    const llm = new ScriptedLLM(["a", "b", "c", "d"]);
    const result = await runDebate({
      topic: "t",
      participants: [pro(llm), con(llm)],
      judge: { kind: "rule", decide: () => ({ verdict: "v", rationale: "r" }) },
    });
    expect(result.rounds).toBe(2);
  });

  it("includes prior exchange in later speakers' prompts", async () => {
    const llm = new ScriptedLLM(["opening", "response"]);
    await runDebate({
      topic: "t",
      participants: [pro(llm), con(llm)],
      judge: { kind: "rule", decide: () => ({ verdict: "v", rationale: "r" }) },
      rounds: 1,
    });
    // Second speaker sees the first's turn in the user content
    expect(llm.lastRequest?.messages[1]?.content).toContain("[pro, round 1] opening");
  });

  it("trims participant output", async () => {
    const llm = new ScriptedLLM(["  padded  \n"]);
    const result = await runDebate({
      topic: "t",
      participants: [pro(llm), con(llm)],
      judge: { kind: "rule", decide: () => ({ verdict: "v", rationale: "r" }) },
      rounds: 1,
    });
    expect(result.exchange[0]?.content).toBe("padded");
  });
});

describe("runDebate — judges", () => {
  it("rule judge receives the topic and full exchange", async () => {
    const llm = new ScriptedLLM(["p", "c"]);
    let seenTopic = "";
    let seenTurns = 0;
    const result = await runDebate({
      topic: "the topic",
      participants: [pro(llm), con(llm)],
      judge: {
        kind: "rule",
        decide: (topic, exchange) => {
          seenTopic = topic;
          seenTurns = exchange.length;
          return { verdict: "ship", rationale: "clear" };
        },
      },
      rounds: 1,
    });
    expect(seenTopic).toBe("the topic");
    expect(seenTurns).toBe(2);
    expect(result.verdict).toBe("ship");
    expect(result.rationale).toBe("clear");
    expect(result.judgeKind).toBe("rule");
  });

  it("human judge is awaited", async () => {
    const llm = new ScriptedLLM(["p", "c"]);
    const result = await runDebate({
      topic: "t",
      participants: [pro(llm), con(llm)],
      judge: {
        kind: "human",
        submit: async () => ({ verdict: "human says yes", rationale: "it's fine" }),
      },
      rounds: 1,
    });
    expect(result.verdict).toBe("human says yes");
    expect(result.judgeKind).toBe("human");
  });

  it("llm judge parses a valid JSON verdict", async () => {
    const speakerLlm = new ScriptedLLM(["p", "c"]);
    const judgeLlm = new ScriptedLLM([
      JSON.stringify({ verdict: "ship", rationale: "pro argument was stronger" }),
    ]);
    const result = await runDebate({
      topic: "t",
      participants: [pro(speakerLlm), con(speakerLlm)],
      judge: { kind: "llm", llm: judgeLlm, model: "judge", stance: "Be fair." },
      rounds: 1,
    });
    expect(result.verdict).toBe("ship");
    expect(result.rationale).toContain("pro");
    expect(result.judgeKind).toBe("llm");
  });

  it("llm judge accepts ```json fences", async () => {
    const speakerLlm = new ScriptedLLM(["p", "c"]);
    const judgeLlm = new ScriptedLLM([
      '```json\n{"verdict":"hold","rationale":"unclear"}\n```',
    ]);
    const result = await runDebate({
      topic: "t",
      participants: [pro(speakerLlm), con(speakerLlm)],
      judge: { kind: "llm", llm: judgeLlm, model: "j", stance: "x" },
      rounds: 1,
    });
    expect(result.verdict).toBe("hold");
  });

  it("llm judge fails closed on invalid JSON", async () => {
    const speakerLlm = new ScriptedLLM(["p", "c"]);
    const judgeLlm = new ScriptedLLM(["absolutely not json"]);
    const result = await runDebate({
      topic: "t",
      participants: [pro(speakerLlm), con(speakerLlm)],
      judge: { kind: "llm", llm: judgeLlm, model: "j", stance: "x" },
      rounds: 1,
    });
    expect(result.verdict).toBe("");
    expect(result.rationale).toContain("invalid JSON");
  });

  it("llm judge uses temperature 0 for determinism", async () => {
    const speakerLlm = new ScriptedLLM(["p", "c"]);
    const judgeLlm = new ScriptedLLM([
      JSON.stringify({ verdict: "v", rationale: "r" }),
    ]);
    await runDebate({
      topic: "t",
      participants: [pro(speakerLlm), con(speakerLlm)],
      judge: { kind: "llm", llm: judgeLlm, model: "j", stance: "x" },
      rounds: 1,
    });
    expect(judgeLlm.lastRequest?.temperature).toBe(0);
  });
});
