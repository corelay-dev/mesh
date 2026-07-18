import type { LLMClient, LLMRequest } from "@corelay/mesh-core";
import type { Embedder } from "./types.js";

export interface LLMEmbedderConfig {
  /** The LLM client (typically an OpenAI or Bedrock client from mesh-llm). */
  llm: LLMClient;
  /** Model id for the embedding calls (e.g. "text-embedding-3-small"). */
  model: string;
  /** Output dimensionality of the embedding model. */
  dimensions: number;
}

/**
 * Produces embeddings by calling an LLM client's chat endpoint with a
 * specialised system prompt that instructs the model to return a JSON
 * array of floats.
 *
 * This is a portable fallback. In production, prefer a native embedding
 * endpoint (OpenAI /embeddings, Bedrock InvokeModel for Titan Embed) by
 * extending Embedder directly. This adapter exists so the retrieval
 * pipeline works with any LLMClient from mesh-llm without requiring a
 * separate SDK.
 */
export class LLMEmbedder implements Embedder {
  private readonly llm: LLMClient;
  private readonly model: string;
  readonly dimensions: number;

  constructor(config: LLMEmbedderConfig) {
    this.llm = config.llm;
    this.model = config.model;
    this.dimensions = config.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return Promise.all(
      texts.map(async (text) => {
        const request: LLMRequest = {
          model: this.model,
          maxTokens: this.dimensions * 12,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `You are an embedding function. Return ONLY a JSON array of ${this.dimensions} floating point numbers representing the semantic embedding of the user's text. No prose, no explanation, no code fences.`,
            },
            { role: "user", content: text },
          ],
        };
        const response = await this.llm.chat(request);
        return parseEmbedding(response.content, this.dimensions);
      }),
    );
  }
}

const parseEmbedding = (raw: string, dimensions: number): number[] => {
  const trimmed = raw.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
    : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    throw new Error(
      `LLMEmbedder: failed to parse embedding response as JSON: ${trimmed.slice(0, 100)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("LLMEmbedder: expected a JSON array of numbers");
  }

  if (parsed.length !== dimensions) {
    throw new Error(
      `LLMEmbedder: expected ${dimensions} dimensions, got ${parsed.length}`,
    );
  }

  for (let i = 0; i < parsed.length; i++) {
    if (typeof parsed[i] !== "number") {
      throw new Error(`LLMEmbedder: element at index ${i} is not a number`);
    }
  }

  return parsed as number[];
};
