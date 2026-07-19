import { describe, it, expect, vi } from "vitest";
import { RetrieverMemoryStore } from "../src/retriever-memory-store.js";
import { MemoryRetriever } from "../src/memory-retriever.js";
import type { Embedder, Retriever, Chunk } from "../src/types.js";
import type { MemoryEntry } from "@corelay/mesh-core";

/**
 * Deterministic embedder: maps character codes to vector components.
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
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vec : vec.map((v) => v / norm);
  }
}

describe("RetrieverMemoryStore", () => {
  const embedder = new DeterministicEmbedder();

  it("writes entries via the writer callback and retrieves them", async () => {
    const written: Array<{ entry: MemoryEntry & { id: string }; embedding: number[] }> = [];

    // Use MemoryRetriever as the backing store
    const retriever = new MemoryRetriever({ embedder });

    const store = new RetrieverMemoryStore({
      retriever,
      embedder,
      writer: async (entry, embedding) => {
        written.push({ entry, embedding });
        // Also add to the MemoryRetriever for subsequent retrieval
        await retriever.addDocuments([{
          id: entry.id,
          content: entry.content,
          metadata: { ...entry.metadata, kind: entry.kind },
          namespace: entry.namespace,
        }]);
      },
    });

    await store.write({
      kind: "semantic",
      content: "User prefers dark mode",
      namespace: "default",
    });

    await store.write({
      kind: "episodic",
      content: "Discussed deployment pipeline",
      namespace: "default",
    });

    expect(written).toHaveLength(2);
    expect(written[0]!.entry.kind).toBe("semantic");
    expect(written[0]!.embedding).toHaveLength(8);

    // Retrieve — should find the entry most similar to the query
    const results = await store.retrieveRelevant("dark mode settings", 5);
    expect(results.length).toBeGreaterThan(0);
    // The dark mode entry should score highest
    expect(results[0]!.content).toContain("dark mode");
  });

  it("auto-generates IDs when not provided", async () => {
    const retriever = new MemoryRetriever({ embedder });
    const ids: string[] = [];

    const store = new RetrieverMemoryStore({
      retriever,
      embedder,
      writer: async (entry) => {
        ids.push(entry.id);
      },
    });

    await store.write({ kind: "semantic", content: "fact one" });
    await store.write({ kind: "semantic", content: "fact two" });

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]!.startsWith("mem-")).toBe(true);
  });

  it("uses provided ID when specified", async () => {
    const retriever = new MemoryRetriever({ embedder });
    let capturedId = "";

    const store = new RetrieverMemoryStore({
      retriever,
      embedder,
      writer: async (entry) => {
        capturedId = entry.id;
      },
    });

    await store.write({ id: "custom-id-123", kind: "semantic", content: "test" });
    expect(capturedId).toBe("custom-id-123");
  });

  it("passes namespace to retriever", async () => {
    const retriever = new MemoryRetriever({ embedder });

    const store = new RetrieverMemoryStore({
      retriever,
      embedder,
      defaultNamespace: "my-agent",
      writer: async (entry) => {
        await retriever.addDocuments([{
          id: entry.id,
          content: entry.content,
          namespace: entry.namespace,
          metadata: { kind: entry.kind },
        }]);
      },
    });

    await store.write({ kind: "semantic", content: "agent-specific fact" });

    // Should find it with correct namespace
    const results = await store.retrieveRelevant("agent-specific", 5, { namespace: "my-agent" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("agent-specific");
  });

  it("maps chunk metadata kind to MemoryRecall kind", async () => {
    // Create a mock retriever that returns chunks with kind in metadata
    const mockRetriever: Retriever = {
      async retrieve(): Promise<Chunk[]> {
        return [
          { id: "1", content: "episodic content", score: 0.9, metadata: { kind: "episodic" } },
          { id: "2", content: "semantic content", score: 0.8, metadata: { kind: "semantic" } },
          { id: "3", content: "unknown content", score: 0.7, metadata: {} },
        ];
      },
    };

    const store = new RetrieverMemoryStore({
      retriever: mockRetriever,
      embedder,
      writer: async () => {},
    });

    const results = await store.retrieveRelevant("anything", 10);
    expect(results[0]!.kind).toBe("episodic");
    expect(results[1]!.kind).toBe("semantic");
    expect(results[2]!.kind).toBe("semantic"); // defaults to semantic
  });

  it("propagates minScore to retriever options", async () => {
    const retrieveSpy = vi.fn().mockResolvedValue([]);
    const mockRetriever: Retriever = { retrieve: retrieveSpy };

    const store = new RetrieverMemoryStore({
      retriever: mockRetriever,
      embedder,
      writer: async () => {},
    });

    await store.retrieveRelevant("query", 3, { minScore: 0.7 });

    expect(retrieveSpy).toHaveBeenCalledWith("query", expect.objectContaining({
      topK: 3,
      minScore: 0.7,
    }));
  });
});
