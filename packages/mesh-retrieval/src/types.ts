/**
 * A chunk is a discrete unit of retrieved content — a paragraph, a document
 * section, a row from a knowledge base. The score is adapter-specific
 * (cosine similarity, BM25, hybrid rank) and always 0–1 normalised.
 */
export interface Chunk {
  /** Unique identifier for the chunk (e.g. document + section hash). */
  id: string;
  /** The textual content. */
  content: string;
  /** Relevance score from the retriever, normalised to [0, 1]. */
  score: number;
  /** Arbitrary metadata (source URL, page number, timestamp, etc.). */
  metadata: Record<string, unknown>;
}

export interface RetrieveOptions {
  /** Maximum number of chunks to return. Default adapter-specific. */
  topK?: number;
  /** Minimum score threshold; chunks below this are discarded. */
  minScore?: number;
  /** Optional namespace / collection filter. */
  namespace?: string;
  /** Caller-provided metadata passed to the adapter (e.g. filter predicates). */
  filter?: Record<string, unknown>;
}

/**
 * The core retrieval primitive. All adapters (pgvector, in-memory, pinecone,
 * etc.) implement this interface.
 */
export interface Retriever {
  retrieve(query: string, opts?: RetrieveOptions): Promise<Chunk[]>;
}

/**
 * An embedder produces vector embeddings from text. Typically backed by an
 * LLM provider (OpenAI text-embedding-3-small, Bedrock Titan, etc.).
 */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
