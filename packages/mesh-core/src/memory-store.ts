/**
 * Long-term / semantic memory layer.
 *
 * MemoryStore provides persistent memory that survives beyond a single session.
 * Two entry kinds are supported:
 *
 * - **episodic**: Conversation excerpts worth remembering (e.g. key decisions,
 *   user preferences discovered during dialog). Tied to a session/agent pair.
 *
 * - **semantic**: Durable facts / knowledge distilled from interactions
 *   (e.g. "User prefers metric units", "The API rate limit is 100 req/s").
 *   Not tied to a single session.
 *
 * The interface is intentionally minimal so adapters can be backed by
 * vector stores, keyword search, or hybrid approaches.
 */

export type MemoryEntryKind = "episodic" | "semantic";

export interface MemoryEntry {
  /** Unique identifier. Implementations may auto-generate if omitted on write. */
  id?: string;
  /** Distinguishes conversation excerpts from distilled facts. */
  kind: MemoryEntryKind;
  /** The textual content to store and later retrieve by similarity. */
  content: string;
  /** Agent or session this entry belongs to. Enables scoping during retrieval. */
  namespace?: string;
  /** Arbitrary metadata (source session, timestamp, tags, etc.). */
  metadata?: Record<string, unknown>;
}

export interface MemoryRecall {
  /** The entry content. */
  content: string;
  /** Relevance score (0–1). Adapter-specific (cosine sim, BM25, etc.). */
  score: number;
  /** Original entry kind. */
  kind: MemoryEntryKind;
  /** Metadata from the stored entry. */
  metadata?: Record<string, unknown>;
}

export interface MemoryRetrieveOptions {
  /** Restrict to a specific namespace. */
  namespace?: string;
  /** Filter by entry kind. If omitted, all kinds are searched. */
  kind?: MemoryEntryKind;
  /** Minimum relevance score threshold. Default 0. */
  minScore?: number;
}

/**
 * Persistent long-term memory store. Implementations may use vector search,
 * keyword search, or hybrid approaches.
 */
export interface MemoryStore {
  /** Persist a memory entry for later retrieval. */
  write(entry: MemoryEntry): Promise<void>;
  /** Retrieve the top-k entries most relevant to the query. */
  retrieveRelevant(query: string, k: number, opts?: MemoryRetrieveOptions): Promise<MemoryRecall[]>;
}

/**
 * In-memory implementation for testing and single-process use.
 * Uses naive keyword overlap scoring (no embeddings required).
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly entries: Array<MemoryEntry & { id: string }> = [];
  private counter = 0;

  async write(entry: MemoryEntry): Promise<void> {
    const id = entry.id ?? `mem-${++this.counter}`;
    this.entries.push({ ...entry, id });
  }

  async retrieveRelevant(
    query: string,
    k: number,
    opts?: MemoryRetrieveOptions,
  ): Promise<MemoryRecall[]> {
    const queryTokens = tokenize(query);
    if (queryTokens.size === 0) return [];

    let candidates = this.entries;
    if (opts?.namespace) {
      candidates = candidates.filter((e) => e.namespace === opts.namespace);
    }
    if (opts?.kind) {
      candidates = candidates.filter((e) => e.kind === opts.kind);
    }

    const minScore = opts?.minScore ?? 0;

    const scored = candidates
      .map((entry) => {
        const entryTokens = tokenize(entry.content);
        const score = jaccardSimilarity(queryTokens, entryTokens);
        return { entry, score };
      })
      .filter((s) => s.score > 0 && s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return scored.map(({ entry, score }) => ({
      content: entry.content,
      score,
      kind: entry.kind,
      metadata: entry.metadata,
    }));
  }

  /** Visible for testing — returns all stored entries. */
  get storedEntries(): ReadonlyArray<MemoryEntry & { id: string }> {
    return this.entries;
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 0),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
