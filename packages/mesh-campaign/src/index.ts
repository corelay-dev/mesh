// Schemas
export * from "./schemas/campaign.js";
export * from "./schemas/message.js";
export * from "./schemas/result.js";
export * from "./schemas/supporter.js";
export * from "./schemas/audit.js";

// Memory
export * from "./memory/brand-voice.js";
export { buildNarrativePrompt, buildCounterNarrativePrompt } from "./memory/prompt-builder.js";
export type { CampaignPromptContext, PromptContextStore } from "./memory/prompt-builder.js";
export { MemoryContextStore } from "./memory/context-store.js";
export { CampaignMemoryStore } from "./memory/campaign-memory.js";
export type { DBQuery } from "./memory/campaign-memory.js";

// Compliance
export { runStaticChecks, BANNED_TERMS, ELECTORAL_VIOLATIONS } from "./compliance/rules.js";
export { reviewContent } from "./compliance/reviewer.js";
export type { ComplianceResult } from "./compliance/rules.js";

// Agent handlers (low-level)
export { handleNarrativeRequest, NarrativeRequestSchema } from "./agents/narrative.js";
export type { NarrativeRequest, NarrativeOutput, NarrativeAgentDeps } from "./agents/narrative.js";
export { handleIntelRequest, IntelRequestSchema, SentimentReportSchema } from "./agents/intel.js";
export type { IntelRequest, SentimentReport, IntelAgentDeps } from "./agents/intel.js";
export { handleStrategyRequest, StrategyRequestSchema, WardPrioritySchema } from "./agents/strategy.js";
export type { StrategyRequest, WardPriority, StrategyAgentDeps } from "./agents/strategy.js";
export { handleResearchRequest, ResearchRequestSchema, VerificationResultSchema } from "./agents/research.js";
export type { ResearchRequest, VerificationResult, ResearchAgentDeps } from "./agents/research.js";
export { handleMobilizationRequest, MobilizationRequestSchema } from "./agents/mobilization.js";
export type { MobilizationRequest, MobilizationOutput, MobilizationAgentDeps } from "./agents/mobilization.js";

// Agent factories (Mesh Peer instances — no wasted LLM calls)
export {
  createNarrativeAgent,
  createIntelAgent,
  createStrategyAgent,
  createResearchAgent,
  createComplianceAgent,
  createMobilizationAgent,
} from "./agents/factories.js";
export type {
  CreateNarrativeAgentOpts,
  CreateIntelAgentOpts,
  CreateStrategyAgentOpts,
  CreateResearchAgentOpts,
  CreateComplianceAgentOpts,
  CreateMobilizationAgentOpts,
} from "./agents/factories.js";

// Workflows
export { runMessagingWorkflow } from "./workflows/messaging.js";
export type { MessagingWorkflowResult, MessagingWorkflowOpts, MessagingWorkflowMessage } from "./workflows/messaging.js";
export { runRapidResponse } from "./workflows/rapid-response.js";
export type { RapidResponseInput, RapidResponseResult } from "./workflows/rapid-response.js";
export { runRepurposeWorkflow, RepurposeInputSchema } from "./workflows/repurpose.js";
export type { RepurposeInput, RepurposeResult, RepurposedPost } from "./workflows/repurpose.js";

// Warroom
export { detectAnomaly, getDashboard } from "./warroom/service.js";
export { ingestResult } from "./warroom/ingest.js";
export type { AggregatedResult, WarRoomDashboard, IngestResultInput, IngestResultOutput } from "./warroom/service.js";
