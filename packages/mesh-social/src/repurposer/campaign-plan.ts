import type { LLMClient } from "@corelay/mesh-core";

export interface CampaignPlan {
  posts: Array<{ index: number; platform: string; angle: string; hook: string }>;
}

export async function generateCampaignPlan(
  content: string,
  platforms: string[],
  postCount: number,
  llm: LLMClient,
): Promise<CampaignPlan> {
  const prompt = `You are a social media strategist. Given the following content, create a campaign plan with ${postCount} posts spread across these platforms: ${platforms.join(", ")}.

Content:
${content}

Return a JSON object with a "posts" array. Each post should have: index (number), platform (string), angle (brief description of the post's angle), hook (the opening hook for the post).

Return ONLY valid JSON.`;

  const response = await llm.chat({
    messages: [{ role: "user", content: prompt }],
    model: "default",
  });

  try {
    const parsed = JSON.parse(response.content) as CampaignPlan;
    return parsed;
  } catch {
    const posts = Array.from({ length: postCount }, (_, i) => ({
      index: i,
      platform: platforms[i % platforms.length]!,
      angle: `Post ${i + 1} about the topic`,
      hook: content.slice(0, 50),
    }));
    return { posts };
  }
}
