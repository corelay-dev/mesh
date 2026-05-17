import { z } from "zod";
import type { LLMClient } from "@corelay/mesh-core";

export const IntelRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sentiment"),
    campaignId: z.string().uuid(),
    inputs: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("daily_brief"),
    campaignId: z.string().uuid(),
  }),
]);
export type IntelRequest = z.infer<typeof IntelRequestSchema>;

export const SentimentReportSchema = z.object({
  overallSentiment: z.enum(["positive", "neutral", "negative"]),
  keyThemes: z.array(z.string()),
  opponentMoves: z.array(z.object({
    actor: z.string(),
    action: z.string(),
    threat: z.enum(["high", "medium", "low"]),
  })),
  recommendations: z.array(z.string()),
});
export type SentimentReport = z.infer<typeof SentimentReportSchema>;

export interface IntelAgentDeps {
  llm: LLMClient;
  getCampaign(id: string): Promise<{ candidateName: string; state: string } | null>;
  getRecentActivity(campaignId: string): Promise<{
    resultsLast24h: Array<{ lga: string; count: number }>;
    messageStats: Array<{ status: string; count: number }>;
    supporterCounts: Array<{ tier: string; count: number }>;
  }>;
}

export async function handleIntelRequest(
  request: IntelRequest,
  deps: IntelAgentDeps,
): Promise<SentimentReport | string> {
  const { llm } = deps;

  switch (request.kind) {
    case "sentiment": {
      const campaign = await deps.getCampaign(request.campaignId);
      if (!campaign) throw new Error(`Campaign ${request.campaignId} not found`);

      const response = await llm.chat({
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "system",
            content: `You are a political intelligence analyst for ${campaign.candidateName}'s campaign in ${campaign.state} State, Nigeria.
Analyze the following social media posts, news snippets, and field reports. Produce a JSON report:
{
  "overallSentiment": "positive"|"neutral"|"negative",
  "keyThemes": ["theme1", "theme2"],
  "opponentMoves": [{"actor": "name", "action": "what they did", "threat": "high"|"medium"|"low"}],
  "recommendations": ["actionable recommendation"]
}
Focus on what matters for winning: voter sentiment shifts, opponent attacks that need response, emerging narratives.`,
          },
          { role: "user", content: request.inputs.join("\n---\n") },
        ],
        maxTokens: 2000,
        temperature: 0.2,
      });

      return SentimentReportSchema.parse(JSON.parse(response.content));
    }

    case "daily_brief": {
      const activity = await deps.getRecentActivity(request.campaignId);

      const sections = [
        "## Daily Campaign Intelligence Brief",
        `Generated: ${new Date().toISOString()}`,
        "",
        "### Results Coverage (24h)",
        activity.resultsLast24h.length > 0
          ? activity.resultsLast24h.map((r) => `- ${r.lga}: ${r.count} polling units reported`).join("\n")
          : "No results reported in last 24 hours.",
        "",
        "### Messaging Activity (24h)",
        activity.messageStats.map((r) => `- ${r.status}: ${r.count}`).join("\n") || "No messages.",
        "",
        "### Supporter Network",
        activity.supporterCounts.map((r) => `- ${r.tier}: ${r.count}`).join("\n") || "No supporters registered.",
      ];

      return sections.join("\n");
    }
  }
}
