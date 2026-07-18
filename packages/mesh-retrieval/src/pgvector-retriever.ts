import type { Pool } from "pg";
import type { Chunk, Embedder, RetrieveOptions, Retriever } from "./types.js";

const SQL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateSqlIdentifier(value: string, label: string): string {
  if (!SQL_IDENTIFIER_RE.test(value)) {
    throw new Error(
      `Invalid SQL identifier for ${label}: "${value}" — must match /^[A-Za-z_][A-Za-z0-9_]*$/`,
    );
  }
  return value;
}

export interface PgVectorRetrieverConfig {
  pool: Pool;
  embedder: Embedder;
  /** Table name storing the vectors. Default "document_chunks". */
  table?: string;
  /** Column name for the embedding vector. Default "embedding". */
  embeddingColumn?: string;
  /** Column name for content text. Default "content". */
  contentColumn?: string;
  /** Column name for namespace partitioning. Default "namespace". */
  namespaceColumn?: string;
  /** Default topK when not specified in opts. Default 5. */
  defaultTopK?: number;
}

/**
 * pgvector-backed retriever. Performs nearest-neighbour search using cosine
 * distance (<=> operator). Requires the pgvector extension.
 *
 * Expects a table shaped like:
 * ```sql
 * CREATE TABLE document_chunks (
 *   id         TEXT PRIMARY KEY,
 *   content    TEXT NOT NULL,
 *   embedding  vector(1536) NOT NULL,
 *   namespace  TEXT NOT NULL DEFAULT 'default',
 *   metadata   JSONB NOT NULL DEFAULT '{}'
 * );
 * CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops);
 * ```
 */
export class PgVectorRetriever implements Retriever {
  private readonly pool: Pool;
  private readonly embedder: Embedder;
  private readonly table: string;
  private readonly embeddingColumn: string;
  private readonly contentColumn: string;
  private readonly namespaceColumn: string;
  private readonly defaultTopK: number;

  constructor(config: PgVectorRetrieverConfig) {
    this.pool = config.pool;
    this.embedder = config.embedder;
    this.table = validateSqlIdentifier(config.table ?? "document_chunks", "table");
    this.embeddingColumn = validateSqlIdentifier(config.embeddingColumn ?? "embedding", "embeddingColumn");
    this.contentColumn = validateSqlIdentifier(config.contentColumn ?? "content", "contentColumn");
    this.namespaceColumn = validateSqlIdentifier(config.namespaceColumn ?? "namespace", "namespaceColumn");
    this.defaultTopK = config.defaultTopK ?? 5;
  }

  async retrieve(query: string, opts?: RetrieveOptions): Promise<Chunk[]> {
    const topK = opts?.topK ?? this.defaultTopK;
    const minScore = opts?.minScore ?? 0;
    const namespace = opts?.namespace ?? "default";

    const [queryEmbedding] = await this.embedder.embed([query]);
    if (!queryEmbedding) {
      return [];
    }

    const vectorLiteral = `[${queryEmbedding.join(",")}]`;

    const sql = `
      SELECT
        id,
        "${this.contentColumn}" AS content,
        metadata,
        1 - ("${this.embeddingColumn}" <=> $1::vector) AS score
      FROM "${this.table}"
      WHERE "${this.namespaceColumn}" = $2
        AND 1 - ("${this.embeddingColumn}" <=> $1::vector) >= $3
      ORDER BY "${this.embeddingColumn}" <=> $1::vector
      LIMIT $4
    `;

    const result = await this.pool.query(sql, [
      vectorLiteral,
      namespace,
      minScore,
      topK,
    ]);

    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row["id"]),
      content: String(row["content"]),
      score: Number(row["score"]),
      metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    }));
  }
}
