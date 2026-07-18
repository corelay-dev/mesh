import { describe, it, expect } from "vitest";
import { GroundingEval } from "../src/grounding-eval.js";
import type { Chunk } from "../src/types.js";
import type { LLMClient, LLMRequest, LLMResponse } from "@corelay/mesh-core";

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

describe("GroundingEval", () => {
  describe("faithfulness", () => {
    it("returns score of 1 when all claims are supported", async () => {
      const llm = new ScriptedLLM([
        // Extract claims
        JSON.stringify(["Returns are allowed within 30 days", "Full refund is given"]),
        // Judge claims
        JSON.stringify([
          { claim: "Returns are allowed within 30 days", supported: true, evidence: "30-day return policy" },
          { claim: "Full refund is given", supported: true, evidence: "full refund on return" },
        ]),
      ]);

      const evaluator = new GroundingEval({ llm });
      const context: Chunk[] = [
        { id: "c1", content: "Our 30-day return policy provides full refund on return.", score: 0.9, metadata: {} },
      ];

      const result = await evaluator.faithfulness({
        answer: "You can return items within 30 days for a full refund.",
        context,
      });

      expect(result.score).toBe(1);
      expect(result.claims).toHaveLength(2);
      expect(result.claims.every((c) => c.supported)).toBe(true);
    });

    it("returns fractional score when some claims are unsupported", async () => {
      const llm = new ScriptedLLM([
        // Extract claims
        JSON.stringify(["Free shipping on orders over $50", "Delivery in 24 hours"]),
        // Judge claims
        JSON.stringify([
          { claim: "Free shipping on orders over $50", supported: true, evidence: "free shipping $50+" },
          { claim: "Delivery in 24 hours", supported: false, evidence: "" },
        ]),
      ]);

      const evaluator = new GroundingEval({ llm });
      const context: Chunk[] = [
        { id: "c1", content: "Free shipping on orders over $50. Standard delivery 3-5 days.", score: 0.8, metadata: {} },
      ];

      const result = await evaluator.faithfulness({
        answer: "You get free shipping over $50 with delivery in 24 hours.",
        context,
      });

      expect(result.score).toBe(0.5);
      expect(result.claims[0]!.supported).toBe(true);
      expect(result.claims[1]!.supported).toBe(false);
    });

    it("returns score of 1 for answers with no factual claims", async () => {
      const llm = new ScriptedLLM([
        // Extract claims — none found
        JSON.stringify([]),
      ]);

      const evaluator = new GroundingEval({ llm });
      const result = await evaluator.faithfulness({
        answer: "I'm not sure about that.",
        context: [{ id: "c1", content: "Some context", score: 0.5, metadata: {} }],
      });

      expect(result.score).toBe(1);
      expect(result.claims).toHaveLength(0);
    });

    it("handles malformed LLM response gracefully", async () => {
      const llm = new ScriptedLLM([
        // Extract claims
        JSON.stringify(["A single claim"]),
        // Judge returns garbage
        "This is not JSON at all",
      ]);

      const evaluator = new GroundingEval({ llm });
      const result = await evaluator.faithfulness({
        answer: "Something factual.",
        context: [{ id: "c1", content: "Stuff", score: 0.9, metadata: {} }],
      });

      expect(result.score).toBe(0);
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0]!.supported).toBe(false);
    });
  });

  describe("contextPrecision", () => {
    it("returns score of 1 when all chunks are relevant", async () => {
      const llm = new ScriptedLLM([
        JSON.stringify([
          { chunkId: "c1", relevant: true, reason: "Directly answers the query" },
          { chunkId: "c2", relevant: true, reason: "Provides supporting detail" },
        ]),
      ]);

      const evaluator = new GroundingEval({ llm });
      const context: Chunk[] = [
        { id: "c1", content: "Relevant chunk 1", score: 0.9, metadata: {} },
        { id: "c2", content: "Relevant chunk 2", score: 0.8, metadata: {} },
      ];

      const result = await evaluator.contextPrecision({ query: "test query", context });

      expect(result.score).toBe(1);
      expect(result.chunkVerdicts).toHaveLength(2);
    });

    it("returns score of 0 when no chunks are relevant", async () => {
      const llm = new ScriptedLLM([
        JSON.stringify([
          { chunkId: "c1", relevant: false, reason: "Off topic" },
          { chunkId: "c2", relevant: false, reason: "Unrelated" },
        ]),
      ]);

      const evaluator = new GroundingEval({ llm });
      const context: Chunk[] = [
        { id: "c1", content: "Irrelevant 1", score: 0.5, metadata: {} },
        { id: "c2", content: "Irrelevant 2", score: 0.4, metadata: {} },
      ];

      const result = await evaluator.contextPrecision({ query: "specific question", context });

      expect(result.score).toBe(0);
    });

    it("penalises irrelevant chunks at higher ranks more heavily", async () => {
      // Case A: relevant chunk at position 1, irrelevant at position 2
      const llmA = new ScriptedLLM([
        JSON.stringify([
          { chunkId: "c1", relevant: true, reason: "Good" },
          { chunkId: "c2", relevant: false, reason: "Bad" },
        ]),
      ]);
      const evalA = new GroundingEval({ llm: llmA });
      const contextA: Chunk[] = [
        { id: "c1", content: "A", score: 0.9, metadata: {} },
        { id: "c2", content: "B", score: 0.8, metadata: {} },
      ];
      const resultA = await evalA.contextPrecision({ query: "q", context: contextA });

      // Case B: irrelevant at position 1, relevant at position 2
      const llmB = new ScriptedLLM([
        JSON.stringify([
          { chunkId: "c1", relevant: false, reason: "Bad" },
          { chunkId: "c2", relevant: true, reason: "Good" },
        ]),
      ]);
      const evalB = new GroundingEval({ llm: llmB });
      const contextB: Chunk[] = [
        { id: "c1", content: "A", score: 0.9, metadata: {} },
        { id: "c2", content: "B", score: 0.8, metadata: {} },
      ];
      const resultB = await evalB.contextPrecision({ query: "q", context: contextB });

      // Relevant chunk at rank 1 should produce higher precision than at rank 2
      expect(resultA.score).toBeGreaterThan(resultB.score);
    });

    it("returns score of 0 for empty context", async () => {
      const llm = new ScriptedLLM([]);
      const evaluator = new GroundingEval({ llm });
      const result = await evaluator.contextPrecision({ query: "q", context: [] });
      expect(result.score).toBe(0);
      expect(result.chunkVerdicts).toHaveLength(0);
    });
  });
});
