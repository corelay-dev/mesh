import { describe, it, expect } from "vitest";
import { HybridRetriever } from "../src/hybrid-retriever.js";
import { MemoryRetriever } from "../src/memory-retriever.js";
import { BM25Retriever } from "../src/keyword-retriever.js";
import type { Chunk, Embedder, Retriever } from "../src/types.js";

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

describe("HybridRetriever", () => {
  const embedder = new DeterministicEmbedder();

  it("fuses results from vector and keyword retrievers via RRF", async () => {
    const docs = [
      { id: "d1", content: "machine learning fundamentals" },
      { id: "d2", content: "deep learning neural networks" },
      { id: "d3", content: "machine vision algorithms" },
    ];

    const vectorRetriever = new MemoryRetriever({
      embedder,
      documents: docs,
    });

    const keywordRetriever = new BM25Retriever({ documents: docs });

    const hybrid = new HybridRetriever({
      vectorRetriever,
      keywordRetriever,
    });

    const results = await hybrid.retrieve("machine learning");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBe(1);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("ranks chunks appearing in both retrievers higher (RRF boost)", async () => {
    const vectorOnly: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [
          { id: "both", content: "appears in both", score: 0.9, metadata: {} },
          { id: "vec-only", content: "vector only", score: 0.8, metadata: {} },
        ];
      },
    };

    const keywordOnly: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [
          { id: "both", content: "appears in both", score: 0.9, metadata: {} },
          { id: "kw-only", content: "keyword only", score: 0.8, metadata: {} },
        ];
      },
    };

    const hybrid = new HybridRetriever({
      vectorRetriever: vectorOnly,
      keywordRetriever: keywordOnly,
    });

    const results = await hybrid.retrieve("test query");

    expect(results[0]!.id).toBe("both");
    expect(results[0]!.score).toBe(1);
  });

  it("respects topK option after fusion", async () => {
    const vectorRetriever = new MemoryRetriever({
      embedder,
      documents: [
        { id: "a", content: "alpha" },
        { id: "b", content: "beta" },
        { id: "c", content: "gamma" },
      ],
    });

    const keywordRetriever = new BM25Retriever({
      documents: [
        { id: "a", content: "alpha" },
        { id: "b", content: "beta" },
        { id: "c", content: "gamma" },
      ],
    });

    const hybrid = new HybridRetriever({ vectorRetriever, keywordRetriever });
    const results = await hybrid.retrieve("alpha beta gamma", { topK: 2 });

    expect(results).toHaveLength(2);
  });

  it("handles empty results from one retriever gracefully", async () => {
    const vectorRetriever: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [
          { id: "v1", content: "from vector", score: 0.8, metadata: {} },
        ];
      },
    };

    const keywordRetriever: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [];
      },
    };

    const hybrid = new HybridRetriever({ vectorRetriever, keywordRetriever });
    const results = await hybrid.retrieve("something");

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("v1");
    expect(results[0]!.score).toBe(1);
  });

  it("applies configurable weights to retrievers", async () => {
    const vectorRetriever: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [{ id: "vec", content: "vector result", score: 1, metadata: {} }];
      },
    };

    const keywordRetriever: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [{ id: "kw", content: "keyword result", score: 1, metadata: {} }];
      },
    };

    const hybrid = new HybridRetriever({
      vectorRetriever,
      keywordRetriever,
      vectorWeight: 2.0,
      keywordWeight: 1.0,
    });

    const results = await hybrid.retrieve("test");

    expect(results[0]!.id).toBe("vec");
  });

  it("respects minScore filter on fused results", async () => {
    const vectorRetriever: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [
          { id: "strong", content: "strong match", score: 1, metadata: {} },
          { id: "weak", content: "weak match", score: 0.1, metadata: {} },
        ];
      },
    };

    const keywordRetriever: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [
          { id: "strong", content: "strong match", score: 1, metadata: {} },
        ];
      },
    };

    const hybrid = new HybridRetriever({
      vectorRetriever,
      keywordRetriever,
    });

    const results = await hybrid.retrieve("test", { minScore: 0.9 });

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("strong");
  });
});
