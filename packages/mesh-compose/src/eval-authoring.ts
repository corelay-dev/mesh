import type { EvalCase, EvalSuite } from "@corelay/mesh-eval";
import type { ComposeSpec } from "./types.js";

/**
 * Auto-generate an eval suite from a ComposeSpec's worked examples.
 *
 * Each example becomes an eval case: the input is the example's input,
 * and the assertions check that the reply contains key phrases from the
 * desired reply. This turns the practitioner's examples into the quality
 * gate automatically — they don't need to understand evals.
 */
export const generateEvalSuite = (
  spec: ComposeSpec,
  suiteName: string,
): EvalSuite => {
  const cases: EvalCase[] = [];

  if (spec.examples) {
    for (const [i, ex] of spec.examples.entries()) {
      const keywords = extractKeywords(ex.desiredReply);
      const assertions = keywords.map((kw) => ({
        kind: "contains" as const,
        value: kw,
        label: `reply contains "${kw}"`,
      }));

      if (assertions.length > 0) {
        cases.push({
          id: `example-${i + 1}`,
          description: `Worked example ${i + 1}: "${truncate(ex.input, 50)}"`,
          input: ex.input,
          assertions,
          tags: ["auto-generated", "example"],
        });
      }
    }
  }

  if (spec.guardrails) {
    for (const [i, g] of spec.guardrails.entries()) {
      const forbidden = extractForbiddenPhrase(g);
      if (forbidden) {
        cases.push({
          id: `guardrail-${i + 1}`,
          description: `Guardrail: ${truncate(g, 60)}`,
          input: "tell me about my situation",
          assertions: [{ kind: "notContains" as const, value: forbidden, label: `guardrail: no "${forbidden}"` }],
          tags: ["auto-generated", "guardrail"],
        });
      }
    }
  }

  return {
    name: suiteName,
    description: `Auto-generated eval suite from ComposeSpec for ${suiteName}.`,
    passThreshold: 1.0,
    cases,
  };
};

/**
 * Extract 2-4 meaningful keywords from a desired reply.
 * Skips stop words and very short words.
 */
const extractKeywords = (text: string): string[] => {
  const stops = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "out", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "each", "every", "both", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "because", "but", "and", "or", "if", "while", "that", "this", "it", "i", "you", "your", "we", "they", "them", "their", "my", "me", "he", "she", "his", "her"]);

  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3 && !stops.has(w));
  const unique = [...new Set(words)];
  return unique.slice(0, 4);
};

const extractForbiddenPhrase = (guardrail: string): string | undefined => {
  const lower = guardrail.toLowerCase();
  const match = lower.match(/never\s+(?:say\s+|use\s+|ask\s+)?["']?([^"'.]+)["']?/);
  if (match?.[1]) return match[1].trim().slice(0, 40);
  const match2 = lower.match(/do not\s+(?:say\s+|use\s+|ask\s+)?["']?([^"'.]+)["']?/);
  if (match2?.[1]) return match2[1].trim().slice(0, 40);
  return undefined;
};

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : s.slice(0, n - 1) + "…";
