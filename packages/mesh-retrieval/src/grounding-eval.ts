import type { LLMClient, LLMRequest } from "@corelay/mesh-core";
import type { Chunk } from "./types.js";

export interface GroundingEvalConfig {
  /** LLM used for judging faithfulness and relevance. */
  llm: LLMClient;
  /** Model id. Default "gpt-4o-mini". */
  model?: string;
}

export interface FaithfulnessResult {
  /** Score between 0 and 1. Fraction of claims in the answer supported by context. */
  score: number;
  /** Individual claim verdicts. */
  claims: ClaimVerdict[];
}

export interface ClaimVerdict {
  claim: string;
  supported: boolean;
  evidence?: string;
}

export interface ContextPrecisionResult {
  /** Score between 0 and 1. Weighted precision of context chunks for the query. */
  score: number;
  /** Per-chunk relevance verdicts. */
  chunkVerdicts: ChunkRelevanceVerdict[];
}

export interface ChunkRelevanceVerdict {
  chunkId: string;
  relevant: boolean;
  reason?: string;
}

/**
 * Grounding eval metrics for RAG pipelines. Built on the mesh-eval pattern
 * of LLM-as-judge but specialised for retrieval quality.
 *
 * - **Faithfulness**: What fraction of claims in the generated answer are
 *   actually grounded in the retrieved context?
 * - **Context Precision**: What fraction of retrieved chunks are actually
 *   relevant to the query? (Weighted by rank position.)
 */
export class GroundingEval {
  private readonly llm: LLMClient;
  private readonly model: string;

  constructor(config: GroundingEvalConfig) {
    this.llm = config.llm;
    this.model = config.model ?? "gpt-4o-mini";
  }

  /**
   * Measure faithfulness: does the answer make claims unsupported by context?
   */
  async faithfulness(params: {
    answer: string;
    context: Chunk[];
  }): Promise<FaithfulnessResult> {
    const claims = await this.extractClaims(params.answer);
    if (claims.length === 0) {
      return { score: 1, claims: [] };
    }

    const contextText = params.context.map((c) => c.content).join("\n\n");
    const verdicts = await this.judgeClaims(claims, contextText);
    const supported = verdicts.filter((v) => v.supported).length;
    const score = supported / verdicts.length;

    return { score, claims: verdicts };
  }

  /**
   * Measure context precision: are the retrieved chunks relevant to the query?
   * Uses rank-weighted scoring (higher-ranked irrelevant chunks penalise more).
   */
  async contextPrecision(params: {
    query: string;
    context: Chunk[];
  }): Promise<ContextPrecisionResult> {
    if (params.context.length === 0) {
      return { score: 0, chunkVerdicts: [] };
    }

    const chunkVerdicts = await this.judgeChunkRelevance(
      params.query,
      params.context,
    );

    const score = computeWeightedPrecision(chunkVerdicts);
    return { score, chunkVerdicts };
  }

  private async extractClaims(answer: string): Promise<string[]> {
    const request: LLMRequest = {
      model: this.model,
      maxTokens: 1024,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Extract all factual claims from the given text. Return a JSON array of strings, " +
            "each being one atomic factual claim. If the text makes no factual claims, return []. " +
            "Return ONLY the JSON array.",
        },
        { role: "user", content: answer },
      ],
    };
    const response = await this.llm.chat(request);
    return parseStringArray(response.content);
  }

  private async judgeClaims(
    claims: string[],
    context: string,
  ): Promise<ClaimVerdict[]> {
    const request: LLMRequest = {
      model: this.model,
      maxTokens: 2048,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a faithfulness judge. For each claim, determine if it is supported by " +
            "the provided context. Return a JSON array of objects with keys: " +
            '"claim" (string), "supported" (boolean), "evidence" (string, quote from context if supported, empty if not). ' +
            "Return ONLY the JSON array.",
        },
        {
          role: "user",
          content: [
            "Context:",
            context,
            "",
            "Claims to verify:",
            JSON.stringify(claims),
          ].join("\n"),
        },
      ],
    };
    const response = await this.llm.chat(request);
    return parseClaimVerdicts(response.content, claims);
  }

  private async judgeChunkRelevance(
    query: string,
    chunks: Chunk[],
  ): Promise<ChunkRelevanceVerdict[]> {
    const chunkDescriptions = chunks.map(
      (c, i) => `[Chunk ${i + 1}, id="${c.id}"]: ${c.content}`,
    );

    const request: LLMRequest = {
      model: this.model,
      maxTokens: 2048,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a context relevance judge. For each chunk, determine if it is relevant " +
            "to answering the user's query. Return a JSON array of objects with keys: " +
            '"chunkId" (string), "relevant" (boolean), "reason" (string, brief explanation). ' +
            "Return ONLY the JSON array.",
        },
        {
          role: "user",
          content: [
            `Query: ${query}`,
            "",
            "Chunks:",
            ...chunkDescriptions,
          ].join("\n"),
        },
      ],
    };
    const response = await this.llm.chat(request);
    return parseChunkVerdicts(response.content, chunks);
  }
}

/**
 * Rank-weighted precision: relevant chunks at higher ranks contribute more.
 * Formula: sum of (precision@k * relevance@k) / total relevant chunks.
 */
const computeWeightedPrecision = (
  verdicts: ChunkRelevanceVerdict[],
): number => {
  const totalRelevant = verdicts.filter((v) => v.relevant).length;
  if (totalRelevant === 0) return 0;

  let cumulativeRelevant = 0;
  let weightedSum = 0;

  for (let k = 0; k < verdicts.length; k++) {
    const v = verdicts[k];
    if (v?.relevant) {
      cumulativeRelevant++;
      const precisionAtK = cumulativeRelevant / (k + 1);
      weightedSum += precisionAtK;
    }
  }

  return weightedSum / totalRelevant;
};

const parseStringArray = (raw: string): string[] => {
  const trimmed = raw.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
    : trimmed;

  try {
    const parsed = JSON.parse(unfenced);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === "string");
    }
  } catch {
    // fallthrough
  }
  return [];
};

const parseClaimVerdicts = (raw: string, claims: string[]): ClaimVerdict[] => {
  const trimmed = raw.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
    : trimmed;

  try {
    const parsed = JSON.parse(unfenced);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown, i: number) => {
        const obj = item as Record<string, unknown>;
        return {
          claim: typeof obj["claim"] === "string" ? obj["claim"] : (claims[i] ?? ""),
          supported: obj["supported"] === true,
          evidence: typeof obj["evidence"] === "string" ? obj["evidence"] : undefined,
        };
      });
    }
  } catch {
    // fallthrough
  }
  return claims.map((c) => ({ claim: c, supported: false }));
};

const parseChunkVerdicts = (
  raw: string,
  chunks: Chunk[],
): ChunkRelevanceVerdict[] => {
  const trimmed = raw.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
    : trimmed;

  try {
    const parsed = JSON.parse(unfenced);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown, i: number) => {
        const obj = item as Record<string, unknown>;
        return {
          chunkId:
            typeof obj["chunkId"] === "string"
              ? obj["chunkId"]
              : (chunks[i]?.id ?? `chunk-${i}`),
          relevant: obj["relevant"] === true,
          reason: typeof obj["reason"] === "string" ? obj["reason"] : undefined,
        };
      });
    }
  } catch {
    // fallthrough
  }
  return chunks.map((c) => ({ chunkId: c.id, relevant: false }));
};
