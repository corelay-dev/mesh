import { z } from "zod";
import type { LLMClient } from "@corelay/mesh-core";

export const StrategyRequestSchema = z.object({
  kind: z.literal("ward_targeting"),
  campaignId: z.string().uuid(),
});
export type StrategyRequest = z.infer<typeof StrategyRequestSchema>;

export const WardPrioritySchema = z.object({
  wards: z.array(z.object({
    ward: z.string(),
    lga: z.string(),
    priority: z.enum(["critical", "high", "medium", "low"]),
    strategy: z.string(),
    estimatedSwingVotes: z.number(),
  })),
  overallStrategy: z.string(),
});
export type WardPriority = z.infer<typeof WardPrioritySchema>;

export interface StrategyAgentDeps {
  llm: LLMClient;
  getCampaign(id: string): Promise<{ candidateName: string; state: string; partyCode: string } | null>;
  getHistoricalResults(campaignId: string, state: string): Promise<Array<{ lga: string; ward: string; results: Record<string, number> }>>;
  getSupporterDistribution(campaignId: string): Promise<Array<{ ward: string; count: number }>>;
}

export async function handleStrategyRequest(
  request: StrategyRequest,
  deps: StrategyAgentDeps,
): Promise<WardPriority> {
  const campaign = await deps.getCampaign(request.campaignId);
  if (!campaign) throw new Error(`Campaign ${request.campaignId} not found`);

  const [historical, supporters] = await Promise.all([
    deps.getHistoricalResults(request.campaignId, campaign.state),
    deps.getSupporterDistribution(request.campaignId),
  ]);

  const response = await deps.llm.chat({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "system",
        content: `You are a campaign strategist for ${campaign.candidateName} (${campaign.partyCode}) in ${campaign.state} State, Nigeria.
Based on historical election results and current supporter data, produce a ward-by-ward targeting strategy.
Respond with JSON: {"wards": [{"ward": "...", "lga": "...", "priority": "critical"|"high"|"medium"|"low", "strategy": "...", "estimatedSwingVotes": N}], "overallStrategy": "..."}
Focus on: swing wards where small gains matter, strongholds to defend, opponent strongholds to chip away at.`,
      },
      {
        role: "user",
        content: [
          "## Historical Results by Ward",
          historical.length > 0
            ? historical.map((h) => `${h.lga}/${h.ward}: ${JSON.stringify(h.results)}`).join("\n")
            : "No historical data available.",
          "",
          "## Current Supporter Distribution",
          supporters.map((r) => `${r.ward}: ${r.count} supporters`).join("\n") || "No supporter data.",
        ].join("\n"),
      },
    ],
    maxTokens: 4000,
    temperature: 0.3,
  });

  return WardPrioritySchema.parse(JSON.parse(response.content));
}
