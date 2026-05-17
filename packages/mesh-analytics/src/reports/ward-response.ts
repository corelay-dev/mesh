import type { AttributionStore } from "../tracker/attribution.js";
import type { EngagementStore } from "../tracker/engagement.js";

export interface WardAnalysis {
  ward: string;
  responseRate: number;
  topPerformingContent: string;
  preferredLanguage: string;
  preferredChannel: string;
}

export interface WardResponseResult {
  wards: WardAnalysis[];
}

export async function analyzeWardResponse(
  campaignId: string,
  attributionStore: AttributionStore,
  engagementStore: EngagementStore,
): Promise<WardResponseResult> {
  const attributions = await attributionStore.getByCampaign(campaignId);
  const engagement = await engagementStore.getByCampaign(campaignId);

  // Group attributions by messageId to infer ward from platform patterns
  const messageEngagement = new Map<string, number>();
  for (const r of engagement) {
    const current = messageEngagement.get(r.messageId) ?? 0;
    messageEngagement.set(r.messageId, current + r.likes + r.replies + r.shares);
  }

  // Group by platform as proxy for ward analysis
  const platformMap = new Map<string, { actions: number; messages: Set<string>; topMessage: string; topScore: number }>();
  for (const attr of attributions) {
    const eng = engagement.find((e) => e.messageId === attr.messageId);
    const platform = eng?.platform ?? "unknown";
    const data = platformMap.get(platform) ?? { actions: 0, messages: new Set(), topMessage: "", topScore: 0 };
    data.actions++;
    data.messages.add(attr.messageId);
    const score = messageEngagement.get(attr.messageId) ?? 0;
    if (score > data.topScore) {
      data.topScore = score;
      data.topMessage = attr.messageId;
    }
    platformMap.set(platform, data);
  }

  const totalActions = attributions.length || 1;
  const wards: WardAnalysis[] = [...platformMap.entries()].map(([platform, data]) => ({
    ward: platform,
    responseRate: data.actions / totalActions,
    topPerformingContent: data.topMessage,
    preferredLanguage: "en",
    preferredChannel: platform,
  }));

  return { wards };
}
