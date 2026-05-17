import type { SocialEvent } from "../platforms/types.js";

export function filterByRelevance(
  events: SocialEvent[],
  campaignKeywords: string[],
  threshold = 0.3,
): SocialEvent[] {
  return events.filter((event) => {
    const score = scoreRelevance(event.content, campaignKeywords);
    return score >= threshold;
  });
}

function scoreRelevance(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lower = content.toLowerCase();
  const matches = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return matches.length / keywords.length;
}
