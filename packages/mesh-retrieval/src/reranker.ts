import type { Chunk, RetrieveOptions, Retriever } from "./types.js";

/**
 * A scorer produces a relevance score for a (query, candidate) pair.
 * This is the injection point for cross-encoder models, LLM-based scoring,
 * or any custom relevance function.
 */
export interface RerankerScorer {
  score(query: string, candidate: string): Promise<number>;
}

/**
 * Pluggable reranker interface. Takes a query and candidate chunks,
 * returns them reordered by relevance with updated scores.
 */
export interface Reranker {
  rerank(query: string, candidates: Chunk[]): Promise<Chunk[]>;
}

export interface ScorerRerankerConfig {
  /** The scoring function (cross-encoder, LLM, etc.). */
  scorer: RerankerScorer;
  /** Maximum candidates to score (truncates input before scoring). Default: all. */
  maxCandidates?: number;
}

/**
 * Reranker backed by an injected scorer function. Scores each candidate
 * independently and reorders by score. Normalises scores to [0, 1].
 *
 * Usage:
 * ```ts
 * const reranker = new ScorerReranker({
 *   scorer: myCrossEncoderScorer,
 * });
 * const reranked = await reranker.rerank("my question", candidates);
 * ```
 */
export class ScorerReranker implements Reranker {
  private readonly scorer: RerankerScorer;
  private readonly maxCandidates: number;

  constructor(config: ScorerRerankerConfig) {
    this.scorer = config.scorer;
    this.maxCandidates = config.maxCandidates ?? Infinity;
  }

  async rerank(query: string, candidates: Chunk[]): Promise<Chunk[]> {
    const toScore = candidates.slice(0, this.maxCandidates);

    const scores = await Promise.all(
      toScore.map((chunk) => this.scorer.score(query, chunk.content)),
    );

    const scored = toScore.map((chunk, i) => ({
      chunk,
      rawScore: scores[i]!,
    }));

    scored.sort((a, b) => b.rawScore - a.rawScore);

    const maxScore = scored[0]?.rawScore ?? 1;
    const minScore = scored[scored.length - 1]?.rawScore ?? 0;
    const range = maxScore - minScore;

    return scored.map(({ chunk, rawScore }) => ({
      ...chunk,
      score: range > 0 ? (rawScore - minScore) / range : 1,
    }));
  }
}

export interface RerankedRetrieverConfig {
  /** The upstream retriever to fetch candidates from. */
  retriever: Retriever;
  /** The reranker to reorder candidates. */
  reranker: Reranker;
  /** How many candidates to fetch from upstream before reranking. Default topK * 4. */
  candidateMultiplier?: number;
}

/**
 * A retriever that wraps another retriever and applies a reranking stage.
 * Fetches more candidates than needed, reranks, then returns topK.
 */
export class RerankedRetriever implements Retriever {
  private readonly retriever: Retriever;
  private readonly reranker: Reranker;
  private readonly candidateMultiplier: number;

  constructor(config: RerankedRetrieverConfig) {
    this.retriever = config.retriever;
    this.reranker = config.reranker;
    this.candidateMultiplier = config.candidateMultiplier ?? 4;
  }

  async retrieve(query: string, opts?: RetrieveOptions): Promise<Chunk[]> {
    const topK = opts?.topK ?? 5;
    const minScore = opts?.minScore ?? 0;

    const candidateOpts: RetrieveOptions = {
      ...opts,
      topK: topK * this.candidateMultiplier,
      minScore: 0,
    };

    const candidates = await this.retriever.retrieve(query, candidateOpts);

    if (candidates.length === 0) return [];

    const reranked = await this.reranker.rerank(query, candidates);

    return reranked
      .filter((c) => c.score >= minScore)
      .slice(0, topK);
  }
}
