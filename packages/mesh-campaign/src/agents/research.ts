import { z } from "zod";
import type { LLMClient } from "@corelay/mesh-core";

export const ResearchRequestSchema = z.object({
  kind: z.literal("verify_claims"),
  campaignId: z.string().uuid(),
  claims: z.array(z.string()),
  context: z.string().optional(),
});
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;

export const VerificationResultSchema = z.object({
  claims: z.array(z.object({
    claim: z.string(),
    verdict: z.enum(["verified", "unverified", "false", "partially_true"]),
    evidence: z.string(),
    source: z.string().nullable(),
  })),
  overallReliability: z.enum(["high", "medium", "low"]),
  suggestedRevisions: z.array(z.string()),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export interface ResearchAgentDeps {
  llm: LLMClient;
  webSearch?(query: string): Promise<Array<{ title: string; snippet: string; url: string }>>;
}

export async function handleResearchRequest(
  request: ResearchRequest,
  deps: ResearchAgentDeps,
): Promise<VerificationResult> {
  const { llm } = deps;

  let webContext = "";
  if (deps.webSearch) {
    const searchResults = await Promise.all(
      request.claims.slice(0, 3).map((claim) => deps.webSearch!(claim)),
    );
    webContext = searchResults
      .flat()
      .map((r) => `[${r.title}](${r.url}): ${r.snippet}`)
      .join("\n");
  }

  const response = await llm.chat({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "system",
        content: `You are a fact-checker for a Nigerian political campaign. Your job is to verify claims before they are published.
For each claim, determine if it is verified, unverified, false, or partially true.
Provide evidence and suggest revisions for any problematic claims.
Respond with JSON:
{
  "claims": [{"claim": "...", "verdict": "verified"|"unverified"|"false"|"partially_true", "evidence": "...", "source": "..."|null}],
  "overallReliability": "high"|"medium"|"low",
  "suggestedRevisions": ["..."]
}
Be conservative — if you cannot verify a claim, mark it "unverified" rather than "verified".`,
      },
      {
        role: "user",
        content: [
          "## Claims to verify:",
          ...request.claims.map((c, i) => `${i + 1}. ${c}`),
          webContext ? `\n## Web research results:\n${webContext}` : "",
          request.context ? `\n## Additional context:\n${request.context}` : "",
        ].join("\n"),
      },
    ],
    maxTokens: 2000,
    temperature: 0.1,
  });

  return VerificationResultSchema.parse(JSON.parse(response.content));
}
