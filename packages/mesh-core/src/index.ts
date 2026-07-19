export { type Address, parseAddress } from "./address.js";
export { type Message, type MessageKind } from "./message.js";
export { type Peer } from "./peer.js";
export { type Inbox, type MessageHandler } from "./inbox.js";
export { MemoryInbox } from "./memory-inbox.js";
export { PeerRegistry, UnknownPeerError } from "./peer-registry.js";
export {
  type Capability,
  type ToolCapability,
  type PeerCapability,
  type ChannelCapability,
  type ChannelName,
} from "./capability.js";
export {
  type ToolDefinition,
  type ToolCall,
  type ToolResult,
} from "./tool.js";
export {
  type LLMClient,
  type LLMMessage,
  type LLMRequest,
  type LLMResponse,
  type TokenUsage,
} from "./llm.js";
export { type AgentConfig } from "./agent-config.js";
export { Agent, CapabilityError, type AgentOptions, type ResponseReviewer } from "./agent.js";
export {
  type StrategyName,
  type StrategyContext,
  type LoopStrategy,
  reactiveStrategy,
  reactStrategy,
  planExecuteStrategy,
  ReflexionStrategy,
  reflexionStrategy,
  type ReflexionConfig,
} from "./strategies/index.js";
export { ToolRegistry, type ToolExecutor, type ToolHandler, type ToolRegistration } from "./tool-executor.js";
export { MemoryConversationBuffer, type ConversationMemory } from "./memory.js";
export {
  InMemoryMemoryStore,
  type MemoryStore,
  type MemoryEntry,
  type MemoryEntryKind,
  type MemoryRecall,
  type MemoryRetrieveOptions,
} from "./memory-store.js";
export {
  type Workflow,
  type WorkflowEvent,
  type WorkflowStatus,
  type WorkflowEventKind,
  type WorkflowEventData,
} from "./workflow.js";
export { type WorkflowRecorder } from "./workflow-recorder.js";
export { run, type RunOptions, type RunResult } from "./run.js";
export { canaryPeer, type CanaryConfig } from "./canary.js";

// --- New exports: parallel tools, context compaction, dynamic peers ---
export {
  ParallelToolExecutor,
  type ParallelToolExecutorOptions,
} from "./parallel-tool-executor.js";
export {
  ContextManager,
  type ContextManagerOptions,
  type ContextSummariser,
  type CompactionEvent,
  type CompactionListener,
} from "./context-manager.js";
export {
  DynamicPeerRegistry,
  DynamicPeerNotFoundError,
  spawnPeer,
  type SpawnPeerOptions,
  type PeerEvent,
  type PeerEventListener,
} from "./dynamic-peer-registry.js";

export const version = "0.1.0";
