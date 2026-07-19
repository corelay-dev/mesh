import type { Chunk, RetrieveOptions, Retriever } from "./types.js";

export interface HybridRetrieverConfig {
  /** Vector/semantic retriever (e.g. PgVectorRetriever, MemoryRetriever). */
  vectorRetriever: Retriever;
  /** Keyword/BM25 retriever (e.g. BM25Retriever, PgKeywordRetriever). */
  keywordRetriever: Retriever;
  /** RRF constant k — controls how much lower-ranked items are penalised. Default 60. */
  rrfK?: number;
  /** Weight applied to vector scores before fusion. Default 1.0. */
  vectorWeight?: number;
  /** Weight applied to keyword scores before fusion. Default 1.0. */
  keywordWeight?: number;
  /** How many results to fetch from each sub-retriever before fusion. Default topK * 3. */
  prefetchMultiplier?: number;
}

/**
 * Hybrid retriever combining semantic (vector) and lexical (keyword/BM25) search
 * using Reciprocal Rank Fusion (RRF).
 *
 * RRF score = sum( weight / (k + rank_i) ) across each retriever where the
 * chunk appears. This is position-based and doesn't require score calibration
 * between heterogeneous retrievers.
 *
 * Usage:
 * ```ts
 * const hybrid = new HybridRetriever({
 *   vectorRetriever: new PgVectorRetriever({ ... }),
 *   keywordRetriever: new PgKeywordRetriever({ ... }),
 * });
 * const chunks = await hybrid.retrieve("my question");
 * ```
 */
export class HybridRetriever implements Retriever {
  private readonly vectorRetriever: Retriever;
  private readonly keywordRetriever: Retriever;
  private readonly rrfK: number;
  private readonly vectorWeight: number;
  private readonly keywordWeight: number;
  private readonly prefetchMultiplier: number;

  constructor(config: HybridRetrieverConfig) {
    this.vectorRetriever = config.vectorRetriever;
    this.keywordRetriever = config.keywordRetriever;
    this.rrfK = config.rrfK ?? 60;
    this.vectorWeight = config.vectorWeight ?? 1.0;
    this.keywordWeight = config.keywordWeight ?? 1.0;
    this.prefetchMultiplier = config.prefetchMultiplier ?? 3;
  }

  async retrieve(query: string, opts?: RetrieveOptions): Promise<Chunk[]> {
    const topK = opts?.topK ?? 5;
    const minScore = opts?.minScore ?? 0;

    const prefetchK = topK * this.prefetchMultiplier;
    const subOpts: RetrieveOptions = {
      ...opts,
      topK: prefetchK,
      minScore: 0, // let RRF handle filtering
    };

    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorRetriever.retrieve(query, subOpts),
      this.keywordRetriever.retrieve(query, subOpts),
    ]);

    const fused = reciprocalRankFusion(
      vectorResults,
      keywordResults,
      this.rrfK,
      this.vectorWeight,
      this.keywordWeight,
    );

    return fused
      .filter((c) => c.score >= minScore)
      .slice(0, topK);
  }
}

interface FusedEntry {
  chunk: Chunk;
  rrfScore: number;
}

function reciprocalRankFusion(
  vectorResults: Chunk[],
  keywordResults: Chunk[],
  k: number,
  vectorWeight: number,
  keywordWeight: number,
): Chunk[] {
  const fusionMap = new Map<string, FusedEntry>();

  for (let rank = 0; rank < vectorResults.length; rank++) {
    const chunk = vectorResults[rank]!;
    const score = vectorWeight / (k + rank + 1);
    const existing = fusionMap.get(chunk.id);
    if (existing) {
      existing.rrfScore += score;
    } else {
      fusionMap.set(chunk.id, { chunk: { ...chunk, score: 0 }, rrfScore: score });
    }
  }

  for (let rank = 0; rank < keywordResults.length; rank++) {
    const chunk = keywordResults[rank]!;
    const score = keywordWeight / (k + rank + 1);
    const existing = fusionMap.get(chunk.id);
    if (existing) {
      existing.rrfScore += score;
    } else {
      fusionMap.set(chunk.id, { chunk: { ...chunk, score: 0 }, rrfScore: score });
    }
  }

  const sorted = [...fusionMap.values()].sort((a, b) => b.rrfScore - a.rrfScore);

  const maxRrf = sorted[0]?.rrfScore ?? 1;
  return sorted.map(({ chunk, rrfScore }) => ({
    ...chunk,
    score: maxRrf > 0 ? rrfScore / maxRrf : 0,
  }));
}
