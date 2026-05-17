import type { EngagementStore } from "../tracker/engagement.js";
import type { RuleStore } from "../reflection/update-prompt.js";

export async function generateFeedbackContext(
  campaignId: string,
  engagementStore: EngagementStore,
  ruleStore: RuleStore,
): Promise<string[]> {
  const context: string[] = [];

  const topRecords = await engagementStore.getTopPerforming(campaignId, 5);
  if (topRecords.length > 0) {
    const themes = topRecords.map(
      (r) => `Message ${r.messageId} on ${r.platform}: ${r.likes} likes, ${r.replies} replies, ${r.shares} shares`,
    );
    context.push(`Top performing content: ${themes.join("; ")}`);
  }

  const rules = await ruleStore.getRules(campaignId);
  const activeRules = rules.filter((r) => r.confidence >= 0.5);
  if (activeRules.length > 0) {
    context.push(`Learned rules: ${activeRules.map((r) => r.rule).join("; ")}`);
  }

  const allRecords = await engagementStore.getByCampaign(campaignId);
  const channelMap = new Map<string, { total: number; count: number }>();
  for (const r of allRecords) {
    const existing = channelMap.get(r.platform) ?? { total: 0, count: 0 };
    existing.total += r.likes + r.replies + r.shares;
    existing.count++;
    channelMap.set(r.platform, existing);
  }
  const channelPerf = [...channelMap.entries()]
    .map(([ch, data]) => `${ch}: avg ${Math.round(data.total / data.count)} engagements`)
    .join("; ");
  if (channelPerf) {
    context.push(`Channel performance: ${channelPerf}`);
  }

  return context;
}
