// Platforms
export type {
  PlatformAdapter,
  PostResult,
  EngagementMetrics,
  Reply,
  SocialEvent,
} from "./platforms/types.js";
export {
  PLATFORM_CONSTRAINTS,
  formatForPlatform,
  validateContent,
  type PlatformConstraint,
  type ValidationResult,
} from "./platforms/formatter.js";
export { TwitterAdapter, type TwitterConfig } from "./platforms/twitter.js";
export { FacebookAdapter, type FacebookConfig } from "./platforms/facebook.js";
export { InstagramAdapter, type InstagramConfig } from "./platforms/instagram.js";

// Scheduler
export { ContentCalendar, type ContentSlot, type DateRange } from "./scheduler/calendar.js";
export { getOptimalSlots } from "./scheduler/optimizer.js";
export {
  NIGERIA_OPTIMAL_TIMES,
  isOptimalTime,
  getNextOptimalTime,
  type TimeWindow,
} from "./scheduler/nigeria-times.js";
export { resolveConflicts } from "./scheduler/conflict-resolver.js";
export {
  InMemoryContentPool,
  type ContentPool,
  type ContentPoolItem,
} from "./scheduler/content-pool.js";
export { createDripCampaign, type DripConfig } from "./scheduler/drip.js";

// Harvester
export { SocialMonitor } from "./harvester/monitor.js";
export { collectEngagement } from "./harvester/collector.js";
export { normalizeToIntelInput } from "./harvester/feed.js";
export { TrendScanner, type TrendReport, type TrendScannerConfig } from "./harvester/trend-scanner.js";
export { ScanCache } from "./harvester/cache.js";
export { filterByRelevance } from "./harvester/relevance-filter.js";

// Repurposer
export { extractContent, type ExtractedContent } from "./repurposer/extract-content.js";
export { generateCampaignPlan, type CampaignPlan } from "./repurposer/campaign-plan.js";
export { generatePlatformPosts, type RepurposedPost } from "./repurposer/generate-posts.js";

// Media
export { TemplateEngine, type Template, type TemplateLayer } from "./media/templates.js";
export { ImageGenerator, type ImageGeneratorConfig, type GenerateOptions } from "./media/generator.js";
export { renderTemplate } from "./media/renderer.js";

// Agents
export { createPublisherAgent, type PublisherDeps } from "./agents/publisher.js";
export { createMonitorAgent, type MonitorDeps } from "./agents/monitor.js";
export { WhatsAppStatusAdapter, type WhatsAppStatusConfig } from "./platforms/whatsapp-status.js";
