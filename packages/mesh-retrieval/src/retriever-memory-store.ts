import type { MemoryStore, MemoryEntry, MemoryRecall, MemoryRetrieveOptions } from "@corelay/mesh-core";
import type { Retriever, Embedder, RetrieveOptions, Chunk } from "./types.js";

/**
 * Configuration for the retriever-backed memory store.
 * The retriever handles search; the writer handles persistence.
 */
export interface RetrieverMemoryStoreConfig {
  /** Retriever for similarity search (e.g. PgVectorRetriever, MemoryRetriever). */
  retriever: Retriever;
  /** Embedder for vectorising entries on write. */
  embedder: Embedder;
  /** Callback to persist an entry with its embedding. Called on write(). */
  writer: MemoryEntryWriter;
  /** Default namespace if not specified on entries. Default "default". */
  defaultNamespace?: string;
}

/**
 * Persists a memory entry with its embedding vector. Implementations can
 * write to Postgres, a file, an external API, etc.
 */
export type MemoryEntryWriter = (
  entry: MemoryEntry & { id: string },
  embedding: number[],
) => Promise<void>;

let idCounter = 0;

/**
 * MemoryStore adapter backed by any Retriever + Embedder combination.
 *
 * - write(): Embeds the entry content and delegates persistence to the writer callback.
 * - retrieveRelevant(): Delegates to the underlying Retriever for vector search.
 *
 * This makes it trivial to back long-term memory with PgVectorRetriever,
 * MemoryRetriever, or any custom retriever.
 */
export class RetrieverMemoryStore implements MemoryStore {
  private readonly retriever: Retriever;
  private readonly embedder: Embedder;
  private readonly writer: MemoryEntryWriter;
  private readonly defaultNamespace: string;

  constructor(config: RetrieverMemoryStoreConfig) {
    this.retriever = config.retriever;
    this.embedder = config.embedder;
    this.writer = config.writer;
    this.defaultNamespace = config.defaultNamespace ?? "default";
  }

  async write(entry: MemoryEntry): Promise<void> {
    const id = entry.id ?? `mem-${Date.now()}-${++idCounter}`;
    const [embedding] = await this.embedder.embed([entry.content]);
    if (!embedding) {
      throw new Error("RetrieverMemoryStore: embedder returned no embedding");
    }
    await this.writer(
      { ...entry, id, namespace: entry.namespace ?? this.defaultNamespace },
      embedding,
    );
  }

  async retrieveRelevant(
    query: string,
    k: number,
    opts?: MemoryRetrieveOptions,
  ): Promise<MemoryRecall[]> {
    const retrieveOpts: RetrieveOptions = {
      topK: k,
      namespace: opts?.namespace ?? this.defaultNamespace,
      minScore: opts?.minScore,
    };

    // Pass kind filter via the generic filter field
    if (opts?.kind) {
      retrieveOpts.filter = { kind: opts.kind };
    }

    const chunks: Chunk[] = await this.retriever.retrieve(query, retrieveOpts);

    return chunks.map((chunk) => ({
      content: chunk.content,
      score: chunk.score,
      kind: (chunk.metadata?.["kind"] as MemoryRecall["kind"]) ?? "semantic",
      metadata: chunk.metadata,
    }));
  }
}
