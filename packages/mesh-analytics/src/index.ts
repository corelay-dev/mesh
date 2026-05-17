// Tracker
export { type EngagementRecord, type DateRange, type EngagementStore, InMemoryEngagementStore } from "./tracker/engagement.js";
export { type DeliveryRecord, type DeliveryStore, InMemoryDeliveryStore } from "./tracker/delivery.js";
export { type AttributionEvent, type AttributionAction, type AttributionStore, InMemoryAttributionStore, attributeAction } from "./tracker/attribution.js";

// Reflection
export { type EditCapture, type EditMetadata, captureEdit, diffContent } from "./reflection/capture-edits.js";
export { extractRule } from "./reflection/extract-rules.js";
export { type RuleStore, InMemoryRuleStore, updatePromptRules } from "./reflection/update-prompt.js";
export { type LearnedRule } from "./reflection/store.js";

// Experiments
export { type ABTest, type ABTestVariant, type ABTestConfig, type ABTestStore, InMemoryABTestStore, createABTest, concludeTest } from "./experiments/ab-test.js";
export { type Segment, type Supporter, createSegments, createSegmentByWard } from "./experiments/segment.js";
export { type SignificanceResult, isSignificant } from "./experiments/significance.js";

// Feedback
export { generateFeedbackContext } from "./feedback/loop.js";
export { type Learning, extractLearnings } from "./feedback/learnings.js";
export { applyDecay, archiveStaleRules } from "./feedback/decay.js";

// Reports
export { generateWeeklyReport } from "./reports/weekly.js";
export { type ChannelComparison, type ChannelCompareResult, compareChannels } from "./reports/channel-compare.js";
export { type WardAnalysis, type WardResponseResult, analyzeWardResponse } from "./reports/ward-response.js";
