import { describe, it, expect } from "vitest";
import { MemoryRetriever } from "../src/memory-retriever.js";
import type { Embedder } from "../src/types.js";

/**
 * Deterministic embedder for tests: maps each character to a dimension.
 * Two texts are "similar" if they share leading characters.
 */
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
    // Normalise
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vec : vec.map((v) => v / norm);
  }
}

describe("MemoryRetriever", () => {
  const embedder = new DeterministicEmbedder();

  it("retrieves chunks sorted by cosine similarity", async () => {
    const retriever = new MemoryRetriever({
      embedder,
      documents: [
        { id: "doc-1", content: "alpha beta gamma" },
        { id: "doc-2", content: "alpha beta delta" },
        { id: "doc-3", content: "omega zeta theta" },
      ],
    });

    const results = await retriever.retrieve("alpha beta gamma");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe("doc-1");
    expect(results[0]!.score).toBeCloseTo(1, 5);
  });

  it("respects topK option", async () => {
    const retriever = new MemoryRetriever({
      embedder,
      documents: [
        { id: "a", content: "foo bar" },
        { id: "b", content: "foo baz" },
        { id: "c", content: "foo qux" },
      ],
    });

    const results = await retriever.retrieve("foo bar", { topK: 1 });
    expect(results).toHaveLength(1);
  });

  it("respects minScore filter", async () => {
    const retriever = new MemoryRetriever({
      embedder,
      documents: [
        { id: "close", content: "hello world" },
        { id: "far", content: "zzzzzzzzz" },
      ],
    });

    const results = await retriever.retrieve("hello world", { minScore: 0.99 });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("close");
  });

  it("respects namespace filtering", async () => {
    const retriever = new MemoryRetriever({
      embedder,
      documents: [
        { id: "ns-a", content: "shared content", namespace: "alpha" },
        { id: "ns-b", content: "shared content", namespace: "beta" },
      ],
    });

    const results = await retriever.retrieve("shared content", { namespace: "alpha" });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("ns-a");
  });

  it("returns empty array when no documents match the namespace", async () => {
    const retriever = new MemoryRetriever({
      embedder,
      documents: [{ id: "x", content: "test", namespace: "private" }],
    });

    const results = await retriever.retrieve("test", { namespace: "public" });
    expect(results).toHaveLength(0);
  });

  it("supports adding documents after construction", async () => {
    const retriever = new MemoryRetriever({ embedder });
    await retriever.addDocuments([
      { id: "late-1", content: "added later" },
    ]);

    const results = await retriever.retrieve("added later");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("late-1");
  });

  it("preserves metadata through retrieval", async () => {
    const retriever = new MemoryRetriever({
      embedder,
      documents: [
        { id: "m-1", content: "has meta", metadata: { source: "test", page: 42 } },
      ],
    });

    const results = await retriever.retrieve("has meta");
    expect(results[0]!.metadata).toEqual({ source: "test", page: 42 });
  });
});
