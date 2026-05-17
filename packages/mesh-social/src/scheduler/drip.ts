import type { ContentSlot } from "./calendar.js";
import { getOptimalSlots } from "./optimizer.js";

export interface DripConfig {
  theme: string;
  days: number;
  platforms: string[];
  campaignId: string;
}

export function createDripCampaign(config: DripConfig): ContentSlot[] {
  const slots: ContentSlot[] = [];
  const postsPerPlatform = config.days;

  for (const platform of config.platforms) {
    const times = getOptimalSlots(platform, postsPerPlatform);
    for (let i = 0; i < times.length; i++) {
      slots.push({
        id: `${config.campaignId}-${platform}-${i}`,
        platform,
        scheduledAt: times[i]!,
        content: "",
        status: "pending",
        campaignId: config.campaignId,
      });
    }
  }

  return slots.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
