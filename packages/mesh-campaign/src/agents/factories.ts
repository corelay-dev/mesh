import type {
  Address,
  LLMClient,
  Message,
  Peer,
  PeerRegistry,
} from "@corelay/mesh-core";
import type { PromptContextStore } from "../memory/prompt-builder.js";
import { handleNarrativeRequest, NarrativeRequestSchema, type NarrativeAgentDeps } from "../agents/narrative.js";
import { handleIntelRequest, IntelRequestSchema, type IntelAgentDeps } from "../agents/intel.js";
import { handleStrategyRequest, StrategyRequestSchema, type StrategyAgentDeps } from "../agents/strategy.js";
import { handleResearchRequest, ResearchRequestSchema, type ResearchAgentDeps } from "../agents/research.js";
import { handleMobilizationRequest, MobilizationRequestSchema, type MobilizationAgentDeps } from "../agents/mobilization.js";
import { reviewContent } from "../compliance/reviewer.js";

/**
 * Creates a Mesh Peer that handles structured JSON requests by delegating
 * to a handler function. No LLM call is made by the peer itself — the handler
 * calls the LLM directly when needed. This avoids the double-call problem
 * of misusing Agent's reviewer hook.
 */
function createHandlerPeer(
  address: Address,
  registry: PeerRegistry,
  handler: (content: string) => Promise<string>,
): Peer {
  const peer: Peer = {
    address,
    async send(message: Message): Promise<void> {
      let responseContent: string;
      try {
        responseContent = await handler(message.content);
      } catch (err) {
        responseContent = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }

      const reply: Message = {
        id: crypto.randomUUID(),
        from: address,
        to: message.from,
        kind: "peer",
        content: responseContent,
        traceId: message.traceId,
        createdAt: Date.now(),
      };
      await registry.deliver(reply);
    },
  };
  return peer;
}

// ── Narrative Agent ──

export interface CreateNarrativeAgentOpts {
  registry: PeerRegistry;
  llm: LLMClient;
  contextStore: PromptContextStore;
}

export function createNarrativeAgent(opts: CreateNarrativeAgentOpts): Peer {
  const deps: NarrativeAgentDeps = { llm: opts.llm, contextStore: opts.contextStore };
  return createHandlerPeer(
    "campaign/narrative" as Address,
    opts.registry,
    async (content) => {
      const request = NarrativeRequestSchema.parse(JSON.parse(content));
      const results = await handleNarrativeRequest(request, deps);
      return JSON.stringify(results);
    },
  );
}

// ── Intel Agent ──

export interface CreateIntelAgentOpts {
  registry: PeerRegistry;
  llm: LLMClient;
  deps: IntelAgentDeps;
}

export function createIntelAgent(opts: CreateIntelAgentOpts): Peer {
  return createHandlerPeer(
    "campaign/intel" as Address,
    opts.registry,
    async (content) => {
      const request = IntelRequestSchema.parse(JSON.parse(content));
      const result = await handleIntelRequest(request, opts.deps);
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  );
}

// ── Strategy Agent ──

export interface CreateStrategyAgentOpts {
  registry: PeerRegistry;
  llm: LLMClient;
  deps: StrategyAgentDeps;
}

export function createStrategyAgent(opts: CreateStrategyAgentOpts): Peer {
  return createHandlerPeer(
    "campaign/strategy" as Address,
    opts.registry,
    async (content) => {
      const request = StrategyRequestSchema.parse(JSON.parse(content));
      const result = await handleStrategyRequest(request, opts.deps);
      return JSON.stringify(result);
    },
  );
}

// ── Research Agent ──

export interface CreateResearchAgentOpts {
  registry: PeerRegistry;
  llm: LLMClient;
  deps: ResearchAgentDeps;
}

export function createResearchAgent(opts: CreateResearchAgentOpts): Peer {
  return createHandlerPeer(
    "campaign/research" as Address,
    opts.registry,
    async (content) => {
      const request = ResearchRequestSchema.parse(JSON.parse(content));
      const result = await handleResearchRequest(request, opts.deps);
      return JSON.stringify(result);
    },
  );
}

// ── Compliance Agent ──

export interface CreateComplianceAgentOpts {
  registry: PeerRegistry;
  llm: LLMClient;
  contextStore: PromptContextStore;
}

export function createComplianceAgent(opts: CreateComplianceAgentOpts): Peer {
  return createHandlerPeer(
    "campaign/compliance" as Address,
    opts.registry,
    async (content) => {
      const { content: msgContent, campaignId } = JSON.parse(content) as { content: string; campaignId: string };
      const ctx = await opts.contextStore.loadContext(campaignId, "compliance");
      const result = await reviewContent(msgContent, ctx, opts.llm);
      return JSON.stringify(result);
    },
  );
}

// ── Mobilization Agent ──

export interface CreateMobilizationAgentOpts {
  registry: PeerRegistry;
  llm: LLMClient;
  deps: MobilizationAgentDeps;
}

export function createMobilizationAgent(opts: CreateMobilizationAgentOpts): Peer {
  return createHandlerPeer(
    "campaign/mobilization" as Address,
    opts.registry,
    async (content) => {
      const request = MobilizationRequestSchema.parse(JSON.parse(content));
      const result = await handleMobilizationRequest(request, opts.deps);
      return JSON.stringify(result);
    },
  );
}
