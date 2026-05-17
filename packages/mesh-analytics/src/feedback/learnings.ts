import type { EngagementRecord } from "../tracker/engagement.js";

export interface Learning {
  campaignId: string;
  type: "content_performance" | "channel_preference" | "audience_response" | "timing";
  insight: string;
  confidence: number;
  source: string;
  createdAt: Date;
}

export function extractLearnings(engagementData: EngagementRecord[], campaignId: string): Learning[] {
  const learnings: Learning[] = [];

  // Channel preference analysis
  const channelMap = new Map<string, { total: number; count: number }>();
  for (const r of engagementData) {
    const existing = channelMap.get(r.platform) ?? { total: 0, count: 0 };
    existing.total += r.likes + r.replies + r.shares;
    existing.count++;
    channelMap.set(r.platform, existing);
  }

  const channels = [...channelMap.entries()].map(([ch, d]) => ({ channel: ch, avg: d.total / d.count }));
  if (channels.length >= 2) {
    const sorted = channels.sort((a, b) => b.avg - a.avg);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;
    if (best.avg > worst.avg * 2) {
      learnings.push({
        campaignId,
        type: "channel_preference",
        insight: `${best.channel} outperforms ${worst.channel} by ${Math.round(best.avg / worst.avg)}x in engagement`,
        confidence: 0.8,
        source: "engagement_analysis",
        createdAt: new Date(),
      });
    }
  }

  // Top content performance
  const sorted = [...engagementData].sort((a, b) => (b.likes + b.replies + b.shares) - (a.likes + a.replies + a.shares));
  if (sorted.length > 0) {
    const top = sorted[0]!;
    const avgEngagement = engagementData.reduce((s, r) => s + r.likes + r.replies + r.shares, 0) / engagementData.length;
    const topEngagement = top.likes + top.replies + top.shares;
    if (topEngagement > avgEngagement * 2) {
      learnings.push({
        campaignId,
        type: "content_performance",
        insight: `Message ${top.messageId} on ${top.platform} got ${Math.round(topEngagement / avgEngagement)}x average engagement`,
        confidence: 0.9,
        source: "engagement_analysis",
        createdAt: new Date(),
      });
    }
  }

  return learnings;
}
