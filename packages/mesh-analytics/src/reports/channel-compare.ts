import type { EngagementStore } from "../tracker/engagement.js";
import type { DeliveryStore } from "../tracker/delivery.js";

export interface ChannelComparison {
  channel: string;
  avgEngagement: number;
  deliveryRate: number;
  bestContentType: string;
  recommendation: string;
}

export interface ChannelCompareResult {
  channels: ChannelComparison[];
}

export async function compareChannels(
  campaignId: string,
  engagementStore: EngagementStore,
  deliveryStore: DeliveryStore,
): Promise<ChannelCompareResult> {
  const engagement = await engagementStore.getByCampaign(campaignId);
  const delivery = await deliveryStore.getByCampaign(campaignId);

  const channelMap = new Map<string, { engagements: number[]; deliveryRates: number[] }>();

  for (const r of engagement) {
    const data = channelMap.get(r.platform) ?? { engagements: [], deliveryRates: [] };
    data.engagements.push(r.likes + r.replies + r.shares);
    channelMap.set(r.platform, data);
  }

  for (const r of delivery) {
    const data = channelMap.get(r.channel) ?? { engagements: [], deliveryRates: [] };
    data.deliveryRates.push(r.deliveryRate);
    channelMap.set(r.channel, data);
  }

  const channels: ChannelComparison[] = [...channelMap.entries()].map(([channel, data]) => {
    const avgEngagement = data.engagements.length > 0
      ? data.engagements.reduce((a, b) => a + b, 0) / data.engagements.length
      : 0;
    const deliveryRate = data.deliveryRates.length > 0
      ? data.deliveryRates.reduce((a, b) => a + b, 0) / data.deliveryRates.length
      : 0;

    let recommendation: string;
    if (avgEngagement > 50 && deliveryRate > 0.8) {
      recommendation = "High performer — increase volume";
    } else if (avgEngagement > 50) {
      recommendation = "Good engagement but delivery issues — investigate";
    } else if (deliveryRate > 0.8) {
      recommendation = "Good delivery but low engagement — improve content";
    } else {
      recommendation = "Underperforming — consider reducing allocation";
    }

    return {
      channel,
      avgEngagement,
      deliveryRate,
      bestContentType: "general",
      recommendation,
    };
  });

  return { channels };
}
