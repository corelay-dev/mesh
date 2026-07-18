import { describe, it, expect } from "vitest";
import { LLMEmbedder } from "../src/embedder.js";
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

describe("LLMEmbedder", () => {
  it("produces embeddings of the correct dimensionality", async () => {
    const embedding = [0.1, 0.2, 0.3, 0.4];
    const llm = new ScriptedLLM([JSON.stringify(embedding)]);
    const embedder = new LLMEmbedder({ llm, model: "embed-model", dimensions: 4 });

    const result = await embedder.embed(["hello"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(embedding);
    expect(embedder.dimensions).toBe(4);
  });

  it("handles multiple texts in parallel", async () => {
    const llm = new ScriptedLLM([
      JSON.stringify([0.1, 0.2, 0.3]),
      JSON.stringify([0.4, 0.5, 0.6]),
    ]);
    const embedder = new LLMEmbedder({ llm, model: "embed-model", dimensions: 3 });

    const result = await embedder.embed(["text one", "text two"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result[1]).toEqual([0.4, 0.5, 0.6]);
    expect(llm.requests).toHaveLength(2);
  });

  it("throws on invalid JSON response", async () => {
    const llm = new ScriptedLLM(["not json at all"]);
    const embedder = new LLMEmbedder({ llm, model: "embed-model", dimensions: 4 });

    await expect(embedder.embed(["test"])).rejects.toThrow("failed to parse");
  });

  it("throws on wrong dimensionality", async () => {
    const llm = new ScriptedLLM([JSON.stringify([0.1, 0.2])]);
    const embedder = new LLMEmbedder({ llm, model: "embed-model", dimensions: 4 });

    await expect(embedder.embed(["test"])).rejects.toThrow("expected 4 dimensions, got 2");
  });

  it("strips code fences from the response", async () => {
    const embedding = [0.5, 0.6, 0.7];
    const llm = new ScriptedLLM(["```json\n" + JSON.stringify(embedding) + "\n```"]);
    const embedder = new LLMEmbedder({ llm, model: "embed-model", dimensions: 3 });

    const result = await embedder.embed(["wrapped"]);
    expect(result[0]).toEqual(embedding);
  });
});
