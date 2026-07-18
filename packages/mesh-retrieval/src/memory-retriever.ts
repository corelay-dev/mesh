import type { Chunk, Embedder, RetrieveOptions, Retriever } from "./types.js";

export interface MemoryDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  namespace?: string;
}

export interface MemoryRetrieverConfig {
  embedder: Embedder;
  /** Pre-loaded documents. Can also add dynamically via addDocuments(). */
  documents?: MemoryDocument[];
}

interface StoredVector {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  namespace: string;
  embedding: number[];
}

/**
 * In-memory vector retriever for testing. Stores embeddings in a plain
 * array and performs brute-force cosine similarity search.
 */
export class MemoryRetriever implements Retriever {
  private readonly embedder: Embedder;
  private readonly store: StoredVector[] = [];
  private initialised = false;
  private readonly pendingDocs: MemoryDocument[];

  constructor(config: MemoryRetrieverConfig) {
    this.embedder = config.embedder;
    this.pendingDocs = config.documents ? [...config.documents] : [];
  }

  async addDocuments(docs: MemoryDocument[]): Promise<void> {
    const texts = docs.map((d) => d.content);
    const embeddings = await this.embedder.embed(texts);

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]!;
      this.store.push({
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata ?? {},
        namespace: doc.namespace ?? "default",
        embedding: embeddings[i]!,
      });
    }
  }

  async retrieve(query: string, opts?: RetrieveOptions): Promise<Chunk[]> {
    if (!this.initialised && this.pendingDocs.length > 0) {
      await this.addDocuments(this.pendingDocs);
      this.pendingDocs.length = 0;
      this.initialised = true;
    }

    const topK = opts?.topK ?? 5;
    const minScore = opts?.minScore ?? 0;
    const namespace = opts?.namespace ?? "default";

    const [queryEmbedding] = await this.embedder.embed([query]);
    if (!queryEmbedding) {
      return [];
    }

    const candidates = this.store.filter((v) => v.namespace === namespace);
    const scored: Chunk[] = candidates
      .map((v) => ({
        id: v.id,
        content: v.content,
        score: cosineSimilarity(queryEmbedding, v.embedding),
        metadata: v.metadata,
      }))
      .filter((c) => c.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }
}

const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};
