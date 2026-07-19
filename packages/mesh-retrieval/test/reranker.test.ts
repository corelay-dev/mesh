import { describe, it, expect } from "vitest";
import {
  ScorerReranker,
  RerankedRetriever,
} from "../src/reranker.js";
import type { Chunk, Retriever } from "../src/types.js";
import type { RerankerScorer } from "../src/reranker.js";

describe("ScorerReranker", () => {
  it("reorders candidates by scorer output", async () => {
    const scorer: RerankerScorer = {
      async score(_query: string, candidate: string): Promise<number> {
        if (candidate.includes("excellent")) return 0.95;
        if (candidate.includes("good")) return 0.7;
        return 0.2;
      },
    };

    const reranker = new ScorerReranker({ scorer });

    const candidates: Chunk[] = [
      { id: "c1", content: "a mediocre answer", score: 0.9, metadata: {} },
      { id: "c2", content: "an excellent answer", score: 0.5, metadata: {} },
      { id: "c3", content: "a good answer", score: 0.7, metadata: {} },
    ];

    const result = await reranker.rerank("question", candidates);

    expect(result[0]!.id).toBe("c2");
    expect(result[1]!.id).toBe("c3");
    expect(result[2]!.id).toBe("c1");
  });

  it("normalises scores to [0, 1]", async () => {
    const scorer: RerankerScorer = {
      async score(_query: string, candidate: string): Promise<number> {
        return candidate.length * 0.1;
      },
    };

    const reranker = new ScorerReranker({ scorer });

    const candidates: Chunk[] = [
      { id: "short", content: "hi", score: 1, metadata: {} },
      { id: "long", content: "a much longer piece of text", score: 0.5, metadata: {} },
    ];

    const result = await reranker.rerank("q", candidates);

    expect(result[0]!.score).toBe(1);
    expect(result[result.length - 1]!.score).toBe(0);
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("respects maxCandidates — only scores up to the limit", async () => {
    let scored = 0;
    const scorer: RerankerScorer = {
      async score(): Promise<number> {
        scored++;
        return Math.random();
      },
    };

    const reranker = new ScorerReranker({ scorer, maxCandidates: 2 });

    const candidates: Chunk[] = [
      { id: "a", content: "one", score: 1, metadata: {} },
      { id: "b", content: "two", score: 1, metadata: {} },
      { id: "c", content: "three", score: 1, metadata: {} },
      { id: "d", content: "four", score: 1, metadata: {} },
    ];

    const result = await reranker.rerank("q", candidates);
    expect(result).toHaveLength(2);
    expect(scored).toBe(2);
  });

  it("handles empty candidates gracefully", async () => {
    const scorer: RerankerScorer = {
      async score(): Promise<number> {
        return 0.5;
      },
    };

    const reranker = new ScorerReranker({ scorer });
    const result = await reranker.rerank("q", []);
    expect(result).toHaveLength(0);
  });
});

describe("RerankedRetriever", () => {
  it("fetches candidates from upstream then reranks", async () => {
    const upstream: Retriever = {
      async retrieve(_query, opts): Promise<Chunk[]> {
        const topK = opts?.topK ?? 5;
        return Array.from({ length: Math.min(topK, 10) }, (_, i) => ({
          id: `doc-${i}`,
          content: `document ${i}`,
          score: 1 - i * 0.1,
          metadata: {},
        }));
      },
    };

    const scorer: RerankerScorer = {
      async score(_query: string, candidate: string): Promise<number> {
        return candidate.includes("5") ? 1 : 0.1;
      },
    };

    const reranked = new RerankedRetriever({
      retriever: upstream,
      reranker: new ScorerReranker({ scorer }),
    });

    const results = await reranked.retrieve("find doc 5", { topK: 3 });

    expect(results).toHaveLength(3);
    expect(results[0]!.id).toBe("doc-5");
    expect(results[0]!.score).toBe(1);
  });

  it("applies minScore filter after reranking", async () => {
    const upstream: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [
          { id: "high", content: "relevant", score: 0.9, metadata: {} },
          { id: "low", content: "irrelevant", score: 0.8, metadata: {} },
        ];
      },
    };

    const scorer: RerankerScorer = {
      async score(_q: string, c: string): Promise<number> {
        return c === "relevant" ? 0.9 : 0.1;
      },
    };

    const reranked = new RerankedRetriever({
      retriever: upstream,
      reranker: new ScorerReranker({ scorer }),
    });

    const results = await reranked.retrieve("test", { topK: 5, minScore: 0.5 });

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("high");
  });

  it("returns empty when upstream returns nothing", async () => {
    const upstream: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [];
      },
    };

    const scorer: RerankerScorer = {
      async score(): Promise<number> {
        return 1;
      },
    };

    const reranked = new RerankedRetriever({
      retriever: upstream,
      reranker: new ScorerReranker({ scorer }),
    });

    const results = await reranked.retrieve("test");
    expect(results).toHaveLength(0);
  });
});
