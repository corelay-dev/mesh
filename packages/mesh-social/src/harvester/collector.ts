import type { PlatformAdapter, EngagementMetrics } from "../platforms/types.js";

export async function collectEngagement(
  adapter: PlatformAdapter,
  postIds: string[],
): Promise<Map<string, EngagementMetrics>> {
  const results = new Map<string, EngagementMetrics>();

  await Promise.all(
    postIds.map(async (id) => {
      try {
        const metrics = await adapter.getEngagement(id);
        results.set(id, metrics);
      } catch {
        // Skip failed fetches
      }
    }),
  );

  return results;
}
