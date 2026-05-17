import type { LLMClient } from "@corelay/mesh-core";
import type { EngagementStore } from "../tracker/engagement.js";
import type { DeliveryStore } from "../tracker/delivery.js";

export async function generateWeeklyReport(
  campaignId: string,
  engagementStore: EngagementStore,
  deliveryStore: DeliveryStore,
  llm: LLMClient,
): Promise<string> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const engagement = await engagementStore.getByCampaign(campaignId, { from: weekAgo, to: now });
  const delivery = await deliveryStore.getByCampaign(campaignId);
  const weekDelivery = delivery.filter((d) => d.measuredAt >= weekAgo && d.measuredAt <= now);

  const totalEngagement = engagement.reduce((s, r) => s + r.likes + r.replies + r.shares, 0);
  const totalImpressions = engagement.reduce((s, r) => s + r.impressions, 0);
  const totalSent = weekDelivery.reduce((s, r) => s + r.sent, 0);
  const totalDelivered = weekDelivery.reduce((s, r) => s + r.delivered, 0);

  const platformBreakdown = new Map<string, { engagement: number; count: number }>();
  for (const r of engagement) {
    const entry = platformBreakdown.get(r.platform) ?? { engagement: 0, count: 0 };
    entry.engagement += r.likes + r.replies + r.shares;
    entry.count++;
    platformBreakdown.set(r.platform, entry);
  }
  const platformSummary = [...platformBreakdown.entries()]
    .map(([p, d]) => `${p}: ${d.count} posts, ${d.engagement} total engagements (avg ${Math.round(d.engagement / d.count)})`)
    .join("\n");

  const summary = [
    `Campaign weekly stats (${weekAgo.toISOString().split("T")[0]} to ${now.toISOString().split("T")[0]}):`,
    `- ${engagement.length} messages tracked`,
    `- ${totalEngagement} total engagements`,
    `- ${totalImpressions} impressions`,
    `- ${totalSent} messages sent, ${totalDelivered} delivered`,
    `- Delivery rate: ${totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0}%`,
    "",
    "Platform breakdown:",
    platformSummary || "No platform data",
  ].join("\n");

  const response = await llm.chat({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "system",
        content: "You are a campaign performance analyst. Write concise, actionable weekly reports for Nigerian political campaign managers. Focus on what's working, what's not, and what to do next week. Keep it under 300 words.",
      },
      {
        role: "user",
        content: `Write a weekly performance narrative based on these metrics:\n\n${summary}`,
      },
    ],
    maxTokens: 512,
    temperature: 0.5,
  });

  return response.content;
}
