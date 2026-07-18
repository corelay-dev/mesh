import type { LLMClient, LLMRequest } from "@corelay/mesh-core";
import { Critic, type CriticConfig } from "@corelay/mesh-coordination";
import type { Chunk, RetrieveOptions, Retriever } from "./types.js";

export interface AgenticRetrieverConfig {
  /** The underlying retriever (pgvector, memory, etc.). */
  retriever: Retriever;
  /** LLM client for the relevance critic and query rewriting. */
  llm: LLMClient;
  /** Model id for critic/rewrite calls. */
  model: string;
  /** Max retrieve→critique→rewrite cycles. Default 2. */
  maxCycles?: number;
  /** Minimum relevance score the critic must report for the context to be accepted. */
  relevanceThreshold?: number;
  /** Extra domain context for the critic prompt. */
  domain?: string;
}

export interface AgenticRetrievalResult {
  /** Final set of relevant chunks. */
  chunks: Chunk[];
  /** Number of retrieve→critique cycles performed. */
  cycles: number;
  /** Whether query rewriting was triggered. */
  rewritten: boolean;
  /** The final query used (may differ from the original if rewritten). */
  finalQuery: string;
}

/**
 * Agentic retrieval: retrieve → Critic judges relevance → re-retrieve with
 * rewritten query if the context is weak.
 *
 * Composes the existing Critic coordination pattern from mesh-coordination
 * rather than reinventing the critique loop. The Critic evaluates whether
 * the retrieved chunks are sufficient to answer the query. If not, it
 * articulates what's missing, and a query-rewrite step produces a better
 * retrieval query for the next cycle.
 */
export class AgenticRetriever implements Retriever {
  private readonly retriever: Retriever;
  private readonly llm: LLMClient;
  private readonly model: string;
  private readonly maxCycles: number;
  private readonly relevanceThreshold: number;
  private readonly critic: Critic;

  constructor(config: AgenticRetrieverConfig) {
    this.retriever = config.retriever;
    this.llm = config.llm;
    this.model = config.model;
    this.maxCycles = config.maxCycles ?? 2;
    this.relevanceThreshold = config.relevanceThreshold ?? 0.7;

    const criticConfig: CriticConfig = {
      llm: config.llm,
      model: config.model,
      domain: config.domain ?? "retrieval relevance",
      guardrails:
        "Judge ONLY whether the retrieved context is sufficient to answer the query. " +
        "APPROVED means the context contains enough relevant information. " +
        "REVISE means the context is missing key information needed to answer the query — " +
        "explain what is missing.",
      maxCycles: 1,
      autoApproveBelowChars: 0,
    };
    this.critic = new Critic(criticConfig);
  }

  async retrieve(query: string, opts?: RetrieveOptions): Promise<Chunk[]> {
    const result = await this.retrieveWithMeta(query, opts);
    return result.chunks;
  }

  async retrieveWithMeta(
    query: string,
    opts?: RetrieveOptions,
  ): Promise<AgenticRetrievalResult> {
    let currentQuery = query;
    let rewritten = false;

    for (let cycle = 1; cycle <= this.maxCycles; cycle++) {
      const chunks = await this.retriever.retrieve(currentQuery, opts);

      if (chunks.length === 0 && cycle < this.maxCycles) {
        currentQuery = await this.rewriteQuery(query, currentQuery, "No results found");
        rewritten = true;
        continue;
      }

      const contextSummary = chunks
        .map((c, i) => `[${i + 1}] (score: ${c.score.toFixed(3)}) ${c.content}`)
        .join("\n\n");

      const verdict = await this.critic.review({
        userMessage: query,
        agentResponse: contextSummary,
        systemPrompt:
          "You are evaluating whether retrieved context chunks are relevant and sufficient " +
          "to answer the user's query. The 'agent response' is the retrieved context, not " +
          "an actual agent reply.",
      });

      if (!verdict.revised) {
        return { chunks, cycles: cycle, rewritten, finalQuery: currentQuery };
      }

      if (cycle < this.maxCycles) {
        const gap = verdict.lastCritique ?? "Context insufficient";
        currentQuery = await this.rewriteQuery(query, currentQuery, gap);
        rewritten = true;
      } else {
        return { chunks, cycles: cycle, rewritten, finalQuery: currentQuery };
      }
    }

    const finalChunks = await this.retriever.retrieve(currentQuery, opts);
    return {
      chunks: finalChunks,
      cycles: this.maxCycles,
      rewritten,
      finalQuery: currentQuery,
    };
  }

  private async rewriteQuery(
    originalQuery: string,
    currentQuery: string,
    gap: string,
  ): Promise<string> {
    const request: LLMRequest = {
      model: this.model,
      maxTokens: 200,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a search query optimizer. Given an original query, the current search query, " +
            "and what information is missing from the results, produce a better search query that " +
            "is more likely to retrieve the missing information. Return ONLY the new query text.",
        },
        {
          role: "user",
          content: [
            `Original question: ${originalQuery}`,
            `Current search query: ${currentQuery}`,
            `What's missing: ${gap}`,
            "",
            "Better search query:",
          ].join("\n"),
        },
      ],
    };
    const response = await this.llm.chat(request);
    return response.content.trim();
  }
}
