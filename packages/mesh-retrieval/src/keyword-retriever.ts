import type { Chunk, RetrieveOptions, Retriever } from "./types.js";

export interface KeywordDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  namespace?: string;
}

export interface BM25RetrieverConfig {
  /** Pre-loaded documents. Can also add dynamically via addDocuments(). */
  documents?: KeywordDocument[];
  /** BM25 k1 parameter — term frequency saturation. Default 1.2. */
  k1?: number;
  /** BM25 b parameter — document length normalisation. Default 0.75. */
  b?: number;
}

interface IndexedDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  namespace: string;
  /** Tokenised terms (lowercased, whitespace split). */
  terms: string[];
  /** Term frequency map. */
  tf: Map<string, number>;
}

/**
 * In-memory BM25 keyword retriever. Suitable for tests and small corpora.
 * For production at scale, use PgKeywordRetriever backed by Postgres ts_rank.
 */
export class BM25Retriever implements Retriever {
  private readonly store: IndexedDocument[] = [];
  private readonly idf = new Map<string, number>();
  private avgDocLen = 0;
  private readonly k1: number;
  private readonly b: number;
  private dirty = true;
  private readonly pendingDocs: KeywordDocument[];

  constructor(config: BM25RetrieverConfig = {}) {
    this.k1 = config.k1 ?? 1.2;
    this.b = config.b ?? 0.75;
    this.pendingDocs = config.documents ? [...config.documents] : [];
  }

  addDocuments(docs: KeywordDocument[]): void {
    for (const doc of docs) {
      const terms = tokenize(doc.content);
      const tf = new Map<string, number>();
      for (const term of terms) {
        tf.set(term, (tf.get(term) ?? 0) + 1);
      }
      this.store.push({
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata ?? {},
        namespace: doc.namespace ?? "default",
        terms,
        tf,
      });
    }
    this.dirty = true;
  }

  async retrieve(query: string, opts?: RetrieveOptions): Promise<Chunk[]> {
    if (this.pendingDocs.length > 0) {
      this.addDocuments(this.pendingDocs);
      this.pendingDocs.length = 0;
    }

    if (this.dirty) {
      this.recomputeStats();
    }

    const topK = opts?.topK ?? 5;
    const minScore = opts?.minScore ?? 0;
    const namespace = opts?.namespace ?? "default";

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const candidates = this.store.filter((d) => d.namespace === namespace);
    if (candidates.length === 0) return [];

    const scored: Array<{ doc: IndexedDocument; score: number }> = [];

    for (const doc of candidates) {
      let score = 0;
      for (const term of queryTerms) {
        const tfVal = doc.tf.get(term) ?? 0;
        if (tfVal === 0) continue;
        const idfVal = this.idf.get(term) ?? 0;
        const numerator = tfVal * (this.k1 + 1);
        const denominator =
          tfVal + this.k1 * (1 - this.b + this.b * (doc.terms.length / this.avgDocLen));
        score += idfVal * (numerator / denominator);
      }
      if (score > 0) {
        scored.push({ doc, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const maxScore = scored[0]?.score ?? 1;
    const normalised: Chunk[] = scored
      .slice(0, topK)
      .map(({ doc, score }) => ({
        id: doc.id,
        content: doc.content,
        score: maxScore > 0 ? score / maxScore : 0,
        metadata: doc.metadata,
      }))
      .filter((c) => c.score >= minScore);

    return normalised;
  }

  private recomputeStats(): void {
    const N = this.store.length;
    if (N === 0) {
      this.avgDocLen = 0;
      this.dirty = false;
      return;
    }

    this.avgDocLen = this.store.reduce((sum, d) => sum + d.terms.length, 0) / N;

    const docFreq = new Map<string, number>();
    for (const doc of this.store) {
      const seen = new Set<string>();
      for (const term of doc.terms) {
        if (!seen.has(term)) {
          docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
          seen.add(term);
        }
      }
    }

    this.idf.clear();
    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
    }

    this.dirty = false;
  }
}

/**
 * Design for Postgres full-text search keyword retriever.
 * Uses ts_rank with plainto_tsquery for BM25-like scoring.
 *
 * Expects a table with a `tsvector` column:
 * ```sql
 * ALTER TABLE document_chunks ADD COLUMN tsv tsvector
 *   GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
 * CREATE INDEX idx_tsv ON document_chunks USING GIN (tsv);
 * ```
 */
export interface PgKeywordRetrieverConfig {
  pool: unknown; // pg.Pool — typed loosely to avoid hard dependency
  /** Table name. Default "document_chunks". */
  table?: string;
  /** Content column. Default "content". */
  contentColumn?: string;
  /** Namespace column. Default "namespace". */
  namespaceColumn?: string;
  /** tsvector column name. Default "tsv". */
  tsvColumn?: string;
  /** ts_rank normalisation flag. Default 32 (divide by rank + 1). */
  rankNormalisation?: number;
  /** Default topK. Default 5. */
  defaultTopK?: number;
}

/**
 * Postgres full-text keyword retriever using ts_rank.
 * Pair this with PgVectorRetriever inside a HybridRetriever for hybrid search.
 *
 * NOTE: This is the design/implementation shell. It requires a live Postgres
 * connection and is not exercised in unit tests.
 */
export class PgKeywordRetriever implements Retriever {
  private readonly pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
  private readonly table: string;
  private readonly contentColumn: string;
  private readonly namespaceColumn: string;
  private readonly tsvColumn: string;
  private readonly rankNorm: number;
  private readonly defaultTopK: number;

  constructor(config: PgKeywordRetrieverConfig) {
    this.pool = config.pool as typeof this.pool;
    this.table = config.table ?? "document_chunks";
    this.contentColumn = config.contentColumn ?? "content";
    this.namespaceColumn = config.namespaceColumn ?? "namespace";
    this.tsvColumn = config.tsvColumn ?? "tsv";
    this.rankNorm = config.rankNormalisation ?? 32;
    this.defaultTopK = config.defaultTopK ?? 5;
  }

  async retrieve(query: string, opts?: RetrieveOptions): Promise<Chunk[]> {
    const topK = opts?.topK ?? this.defaultTopK;
    const minScore = opts?.minScore ?? 0;
    const namespace = opts?.namespace ?? "default";

    const sql = `
      SELECT
        id,
        "${this.contentColumn}" AS content,
        metadata,
        ts_rank("${this.tsvColumn}", plainto_tsquery('english', $1), ${this.rankNorm}) AS score
      FROM "${this.table}"
      WHERE "${this.tsvColumn}" @@ plainto_tsquery('english', $1)
        AND "${this.namespaceColumn}" = $2
        AND ts_rank("${this.tsvColumn}", plainto_tsquery('english', $1), ${this.rankNorm}) >= $3
      ORDER BY score DESC
      LIMIT $4
    `;

    const result = await this.pool.query(sql, [query, namespace, minScore, topK]);

    return result.rows.map((row) => ({
      id: String(row["id"]),
      content: String(row["content"]),
      score: Number(row["score"]),
      metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    }));
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}
