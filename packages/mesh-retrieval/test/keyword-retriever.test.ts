import { describe, it, expect } from "vitest";
import { BM25Retriever } from "../src/keyword-retriever.js";

describe("BM25Retriever", () => {
  it("ranks documents by term overlap relevance", async () => {
    const retriever = new BM25Retriever({
      documents: [
        { id: "d1", content: "the cat sat on the mat" },
        { id: "d2", content: "the dog chased the ball" },
        { id: "d3", content: "cat food and cat toys" },
      ],
    });

    const results = await retriever.retrieve("cat");

    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("d1");
    expect(ids).toContain("d3");
    expect(ids).not.toContain("d2");
  });

  it("returns the highest-scoring match first (exact term frequency)", async () => {
    const retriever = new BM25Retriever({
      documents: [
        { id: "once", content: "machine learning basics" },
        { id: "twice", content: "machine learning and machine vision" },
      ],
    });

    const results = await retriever.retrieve("machine");

    expect(results[0]!.id).toBe("twice");
    expect(results[0]!.score).toBe(1);
  });

  it("returns normalised scores in [0, 1]", async () => {
    const retriever = new BM25Retriever({
      documents: [
        { id: "a", content: "alpha beta gamma" },
        { id: "b", content: "alpha delta" },
        { id: "c", content: "epsilon zeta" },
      ],
    });

    const results = await retriever.retrieve("alpha beta");

    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    expect(results[0]!.score).toBe(1);
  });

  it("respects topK option", async () => {
    const retriever = new BM25Retriever({
      documents: [
        { id: "a", content: "foo bar" },
        { id: "b", content: "foo baz" },
        { id: "c", content: "foo qux" },
      ],
    });

    const results = await retriever.retrieve("foo", { topK: 2 });
    expect(results).toHaveLength(2);
  });

  it("respects minScore filter", async () => {
    const retriever = new BM25Retriever({
      documents: [
        { id: "strong", content: "typescript javascript programming" },
        { id: "weak", content: "typescript is a language for types" },
      ],
    });

    const results = await retriever.retrieve("typescript javascript programming", {
      minScore: 0.99,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("strong");
  });

  it("respects namespace filtering", async () => {
    const retriever = new BM25Retriever({
      documents: [
        { id: "ns-a", content: "same content here", namespace: "alpha" },
        { id: "ns-b", content: "same content here", namespace: "beta" },
      ],
    });

    const results = await retriever.retrieve("same content", { namespace: "alpha" });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("ns-a");
  });

  it("returns empty array for queries with no matching terms", async () => {
    const retriever = new BM25Retriever({
      documents: [{ id: "x", content: "apple banana cherry" }],
    });

    const results = await retriever.retrieve("xylophone");
    expect(results).toHaveLength(0);
  });

  it("supports adding documents after construction", async () => {
    const retriever = new BM25Retriever();
    retriever.addDocuments([{ id: "late", content: "dynamically added document" }]);

    const results = await retriever.retrieve("dynamically added");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("late");
  });

  it("preserves metadata through retrieval", async () => {
    const retriever = new BM25Retriever({
      documents: [
        { id: "m", content: "metadata test", metadata: { source: "unit", page: 7 } },
      ],
    });

    const results = await retriever.retrieve("metadata test");
    expect(results[0]!.metadata).toEqual({ source: "unit", page: 7 });
  });
});
