import { describe, it, expect } from "vitest";
import { AgenticRetriever } from "../src/agentic-retriever.js";
import { MemoryRetriever } from "../src/memory-retriever.js";
import type { Embedder } from "../src/types.js";
import type { LLMClient, LLMRequest, LLMResponse } from "@corelay/mesh-core";

class DeterministicEmbedder implements Embedder {
  readonly dimensions = 8;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.textToVector(t));
  }

  private textToVector(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < Math.min(text.length, this.dimensions); i++) {
      vec[i] = (text.charCodeAt(i) % 26) / 26;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vec : vec.map((v) => v / norm);
  }
}

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

describe("AgenticRetriever", () => {
  const embedder = new DeterministicEmbedder();

  it("returns chunks directly when critic approves on first cycle", async () => {
    const baseRetriever = new MemoryRetriever({
      embedder,
      documents: [
        { id: "d1", content: "The refund policy allows returns within 30 days." },
        { id: "d2", content: "Shipping takes 3-5 business days." },
      ],
    });

    const llm = new ScriptedLLM(["APPROVED"]);

    const agentic = new AgenticRetriever({
      retriever: baseRetriever,
      llm,
      model: "gpt-4o-mini",
      maxCycles: 2,
    });

    const result = await agentic.retrieveWithMeta("refund policy");

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.cycles).toBe(1);
    expect(result.rewritten).toBe(false);
    expect(result.finalQuery).toBe("refund policy");
  });

  it("rewrites query and re-retrieves when critic finds context insufficient", async () => {
    const baseRetriever = new MemoryRetriever({
      embedder,
      documents: [
        { id: "d1", content: "General company info about products." },
        { id: "d2", content: "Detailed refund policy: 30-day returns, full refund." },
      ],
    });

    const llm = new ScriptedLLM([
      // Cycle 1: Critic critique call → REVISE
      "REVISE: The context lacks specific refund policy details",
      // Cycle 1: Critic internal revise call (maxCycles=1, so it returns after this)
      "Revised context summary — not actually used",
      // Query rewrite call from AgenticRetriever
      "refund policy details 30-day returns",
      // Cycle 2: Critic critique call → APPROVED
      "APPROVED",
    ]);

    const agentic = new AgenticRetriever({
      retriever: baseRetriever,
      llm,
      model: "gpt-4o-mini",
      maxCycles: 2,
    });

    const result = await agentic.retrieveWithMeta("What can I return?");

    expect(result.cycles).toBe(2);
    expect(result.rewritten).toBe(true);
    expect(result.finalQuery).not.toBe("What can I return?");
  });

  it("returns best available chunks when maxCycles exhausted", async () => {
    const baseRetriever = new MemoryRetriever({
      embedder,
      documents: [{ id: "d1", content: "Some generic content" }],
    });

    const llm = new ScriptedLLM([
      // Cycle 1: Critic critique → REVISE
      "REVISE: Not enough detail about pricing",
      // Cycle 1: Critic internal revise
      "Revised summary",
      // Query rewrite
      "pricing information details",
      // Cycle 2: Critic critique → REVISE (but maxCycles exhausted, so returns anyway)
      "REVISE: Still insufficient",
      // Cycle 2: Critic internal revise (maxCycles=1 inside critic)
      "Still revised",
    ]);

    const agentic = new AgenticRetriever({
      retriever: baseRetriever,
      llm,
      model: "gpt-4o-mini",
      maxCycles: 2,
    });

    const result = await agentic.retrieveWithMeta("What are the prices?");

    expect(result.cycles).toBe(2);
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("implements the Retriever interface (retrieve method)", async () => {
    const baseRetriever = new MemoryRetriever({
      embedder,
      documents: [{ id: "d1", content: "Relevant doc content here" }],
    });

    const llm = new ScriptedLLM(["APPROVED"]);

    const agentic = new AgenticRetriever({
      retriever: baseRetriever,
      llm,
      model: "gpt-4o-mini",
    });

    const chunks = await agentic.retrieve("relevant doc");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.content).toContain("Relevant doc");
  });

  it("handles empty results by triggering a rewrite", async () => {
    let callCount = 0;
    const switchingRetriever = {
      async retrieve(query: string) {
        callCount++;
        if (callCount === 1) return [];
        return [{ id: "found", content: "Found on retry", score: 0.9, metadata: {} }];
      },
    };

    const llm = new ScriptedLLM([
      // Query rewrite (triggered by empty results)
      "better search terms",
      // Critic approves on second cycle
      "APPROVED",
    ]);

    const agentic = new AgenticRetriever({
      retriever: switchingRetriever,
      llm,
      model: "gpt-4o-mini",
      maxCycles: 2,
    });

    const result = await agentic.retrieveWithMeta("original query");
    expect(result.rewritten).toBe(true);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.id).toBe("found");
  });
});
