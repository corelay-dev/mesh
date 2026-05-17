import type { LLMClient } from "@corelay/mesh-core";
import type { CampaignPlan } from "./campaign-plan.js";
import { formatForPlatform } from "../platforms/formatter.js";

export interface RepurposedPost {
  index: number;
  platform: string;
  content: string;
  language: string;
}

export async function generatePlatformPosts(
  plan: CampaignPlan,
  llm: LLMClient,
  language: string,
): Promise<RepurposedPost[]> {
  const results: RepurposedPost[] = [];

  for (const post of plan.posts) {
    const prompt = `Write a ${post.platform} post in ${language}. Angle: ${post.angle}. Hook: ${post.hook}. Return ONLY the post text, no explanation.`;

    const response = await llm.chat({
      messages: [{ role: "user", content: prompt }],
      model: "default",
    });

    const formatted = formatForPlatform(response.content, post.platform);
    results.push({
      index: post.index,
      platform: post.platform,
      content: formatted,
      language,
    });
  }

  return results;
}
