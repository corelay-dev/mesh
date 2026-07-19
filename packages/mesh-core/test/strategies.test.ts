import { describe, it, expect, vi } from "vitest";
import { Agent } from "../src/agent.js";
import { MemoryInbox } from "../src/memory-inbox.js";
import { PeerRegistry } from "../src/peer-registry.js";
import { ToolRegistry } from "../src/tool-executor.js";
import type { AgentConfig } from "../src/agent-config.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/llm.js";
import type { Message } from "../src/message.js";
import type { Peer } from "../src/peer.js";
import { reactStrategy } from "../src/strategies/react.js";
import { planExecuteStrategy } from "../src/strategies/plan-execute.js";
import { ReflexionStrategy, reflexionStrategy } from "../src/strategies/reflexion.js";
import { reactiveStrategy } from "../src/strategies/reactive.js";
import type { StrategyContext } from "../src/strategies/types.js";

const baseConfig: AgentConfig = {
  name: "test-agent",
  description: "A test agent",
  prompt: "You are helpful.",
  model: "gpt-4o-mini",
  maxResponseTokens: 100,
  welcomeMessage: "",
  guardrails: "",
  tools: [],
  capabilities: [{ kind: "peer", address: "test/user" }],
};

const msg = (content: string): Message => ({
  id: "m-1",
  from: "test/user",
  to: "test/agent",
  kind: "user",
  content,
  traceId: "t-1",
  createdAt: 0,
});

const sinkPeer = (address: `${string}/${string}`): Peer & { received: Message[] } => ({
  address,
  received: [],
  async send(m) {
    (this as unknown as { received: Message[] }).received.push(m);
  },
});

function mockLLM(responses: string[] | ((req: LLMRequest) => LLMResponse)): LLMClient {
  if (typeof responses === "function") {
    return { name: "mock", chat: async (req) => responses(req) };
  }
  let callIndex = 0;
  return {
    name: "mock",
    async chat(req: LLMRequest): Promise<LLMResponse> {
      const content = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      return {
        content,
        model: req.model,
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop",
      };
    },
  };
}

describe("Agent loop strategies", () => {
  describe("default (no strategy)", () => {
    it("uses the default reactive tool-calling loop when strategy is undefined", async () => {
      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const chatFn = vi.fn(async (req: LLMRequest): Promise<LLMResponse> => ({
        content: "default reply",
        model: req.model,
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop",
      }));

      const llm: LLMClient = { name: "mock", chat: chatFn };
      const agent = new Agent("test/agent", baseConfig, llm, new MemoryInbox(), registry);
      registry.register(agent);
      await agent.start();

      await agent.send(msg("hello"));
      await new Promise((r) => setImmediate(r));

      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toBe("default reply");
      // Only 1 LLM call for a simple response
      expect(chatFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("ReAct strategy", () => {
    it("injects reasoning instruction into system prompt", async () => {
      const captured: LLMRequest[] = [];
      const llm: LLMClient = {
        name: "mock",
        async chat(req) {
          captured.push(req);
          return {
            content: "Thought: I should greet.\n\nHello there!",
            model: req.model,
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
          };
        },
      };

      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const agent = new Agent("test/agent", baseConfig, llm, new MemoryInbox(), registry, {
        strategy: "react",
      });
      registry.register(agent);
      await agent.start();

      await agent.send(msg("hi"));
      await new Promise((r) => setImmediate(r));

      // System prompt should have ReAct suffix
      const systemMsg = captured[0]?.messages[0];
      expect(systemMsg?.content).toContain("Thought:");
      expect(systemMsg?.content).toContain("reasoning");

      // Final answer should have the thought stripped
      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toBe("Hello there!");
    });

    it("runs tool calls with interleaved reasoning", async () => {
      let callIndex = 0;
      const llm: LLMClient = {
        name: "mock",
        async chat(req): Promise<LLMResponse> {
          callIndex++;
          if (callIndex === 1) {
            return {
              content: "Thought: I need to search for this.\n",
              model: req.model,
              toolCalls: [{ id: "tc-1", name: "search", arguments: { q: "test" } }],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "tool_calls",
            };
          }
          return {
            content: "Based on the search, here is the answer.",
            model: req.model,
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
          };
        },
      };

      const toolExecutor = new ToolRegistry({ search: async () => "result" });
      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const config = { ...baseConfig, tools: [{ name: "search", description: "Search", parameters: {} }] };
      const agent = new Agent("test/agent", config, llm, new MemoryInbox(), registry, {
        strategy: "react",
        toolExecutor,
      });
      registry.register(agent);
      await agent.start();

      await agent.send(msg("find something"));
      await new Promise((r) => setImmediate(r));

      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toBe("Based on the search, here is the answer.");
    });
  });

  describe("Plan-and-Execute strategy", () => {
    it("generates a plan then executes each step sequentially", async () => {
      let callIndex = 0;
      const llm: LLMClient = {
        name: "mock",
        async chat(req): Promise<LLMResponse> {
          callIndex++;
          if (callIndex === 1) {
            // Planner call
            return {
              content: "1. Search for information\n2. Summarise findings",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          if (callIndex === 2) {
            // Execute step 1
            return {
              content: "Found relevant data about topic X.",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          if (callIndex === 3) {
            // Execute step 2
            return {
              content: "Summary: topic X is important.",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          // Synthesis call
          return {
            content: "Final answer: topic X is important based on research.",
            model: req.model,
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
          };
        },
      };

      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const agent = new Agent("test/agent", baseConfig, llm, new MemoryInbox(), registry, {
        strategy: "plan-execute",
      });
      registry.register(agent);
      await agent.start();

      await agent.send(msg("research topic X"));
      await new Promise((r) => setImmediate(r));

      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toBe("Final answer: topic X is important based on research.");
      // 4 calls: planner + 2 executor steps + synthesis
      expect(callIndex).toBe(4);
    });

    it("uses tools during step execution", async () => {
      let callIndex = 0;
      const llm: LLMClient = {
        name: "mock",
        async chat(req): Promise<LLMResponse> {
          callIndex++;
          if (callIndex === 1) {
            return {
              content: "1. Look up the data",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          if (callIndex === 2) {
            // Step executor calls a tool
            return {
              content: "",
              model: req.model,
              toolCalls: [{ id: "tc-1", name: "lookup", arguments: { key: "data" } }],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "tool_calls",
            };
          }
          if (callIndex === 3) {
            // After tool result, step completes
            return {
              content: "Got the data: value=42",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          // Synthesis
          return {
            content: "The answer is 42.",
            model: req.model,
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
          };
        },
      };

      const toolExecutor = new ToolRegistry({ lookup: async () => "value=42" });
      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const config = { ...baseConfig, tools: [{ name: "lookup", description: "Lookup", parameters: {} }] };
      const agent = new Agent("test/agent", config, llm, new MemoryInbox(), registry, {
        strategy: "plan-execute",
        toolExecutor,
      });
      registry.register(agent);
      await agent.start();

      await agent.send(msg("get data"));
      await new Promise((r) => setImmediate(r));

      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toBe("The answer is 42.");
    });
  });

  describe("Reflexion strategy", () => {
    it("approves a response immediately when critique says APPROVED", async () => {
      let callIndex = 0;
      const llm: LLMClient = {
        name: "mock",
        async chat(req): Promise<LLMResponse> {
          callIndex++;
          if (callIndex === 1) {
            // Initial reactive response (>50 chars to trigger reflexion)
            return {
              content: "Here is a detailed answer about the topic that is long enough to trigger reflexion checks.",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          // Self-critique call — approve
          return {
            content: "APPROVED",
            model: req.model,
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
          };
        },
      };

      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const agent = new Agent("test/agent", baseConfig, llm, new MemoryInbox(), registry, {
        strategy: "reflexion",
      });
      registry.register(agent);
      await agent.start();

      await agent.send(msg("explain something"));
      await new Promise((r) => setImmediate(r));

      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toContain("detailed answer about the topic");
      // 2 calls: initial response + 1 critique
      expect(callIndex).toBe(2);
    });

    it("revises when critique says REVISE and returns the revised version", async () => {
      let callIndex = 0;
      const llm: LLMClient = {
        name: "mock",
        async chat(req): Promise<LLMResponse> {
          callIndex++;
          if (callIndex === 1) {
            // Initial reactive response
            return {
              content: "This answer has a mistake that needs to be corrected by the reflexion process.",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          if (callIndex === 2) {
            // First critique — revise
            return {
              content: "REVISE: The response contains an inaccuracy",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          if (callIndex === 3) {
            // Revision
            return {
              content: "Here is the corrected answer with accurate information about the topic in question.",
              model: req.model,
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
            };
          }
          // Second critique — approve
          return {
            content: "APPROVED",
            model: req.model,
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
          };
        },
      };

      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const agent = new Agent("test/agent", baseConfig, llm, new MemoryInbox(), registry, {
        strategy: "reflexion",
      });
      registry.register(agent);
      await agent.start();

      await agent.send(msg("explain something"));
      await new Promise((r) => setImmediate(r));

      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toContain("corrected answer");
      // 4 calls: initial + critique + revision + critique
      expect(callIndex).toBe(4);
    });

    it("skips reflexion for short responses below threshold", async () => {
      let callIndex = 0;
      const llm: LLMClient = {
        name: "mock",
        async chat(req): Promise<LLMResponse> {
          callIndex++;
          return {
            content: "ok",
            model: req.model,
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
          };
        },
      };

      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const agent = new Agent("test/agent", baseConfig, llm, new MemoryInbox(), registry, {
        strategy: "reflexion",
      });
      registry.register(agent);
      await agent.start();

      await agent.send(msg("yes?"));
      await new Promise((r) => setImmediate(r));

      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toBe("ok");
      // Only 1 call — no critique needed for short responses
      expect(callIndex).toBe(1);
    });
  });

  describe("custom LoopStrategy object", () => {
    it("accepts a custom LoopStrategy instance", async () => {
      const customStrategy = {
        name: "react" as const,
        run: vi.fn(async () => "custom strategy output"),
      };

      const registry = new PeerRegistry();
      const user = sinkPeer("test/user");
      registry.register(user);

      const agent = new Agent("test/agent", baseConfig, mockLLM(["unused"]), new MemoryInbox(), registry, {
        strategy: customStrategy,
      });
      registry.register(agent);
      await agent.start();

      await agent.send(msg("test"));
      await new Promise((r) => setImmediate(r));

      expect(user.received).toHaveLength(1);
      expect(user.received[0]?.content).toBe("custom strategy output");
      expect(customStrategy.run).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Strategy unit tests (standalone)", () => {
  const baseCtx: StrategyContext = {
    llm: mockLLM(["response"]),
    model: "test-model",
    maxTokens: 100,
    tools: [],
    toolExecutor: undefined,
    maxToolRounds: 10,
    systemPrompt: "You are helpful.",
  };

  describe("reactiveStrategy", () => {
    it("returns the LLM content directly for a non-tool response", async () => {
      const result = await reactiveStrategy.run(
        [{ role: "system", content: "test" }, { role: "user", content: "hi" }],
        { ...baseCtx, llm: mockLLM(["direct answer"]) },
      );
      expect(result).toBe("direct answer");
    });
  });

  describe("reactStrategy", () => {
    it("augments the system prompt with ReAct instructions", async () => {
      const captured: LLMRequest[] = [];
      const llm: LLMClient = {
        name: "mock",
        async chat(req) {
          captured.push(req);
          return {
            content: "Answer: hello",
            model: req.model,
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
          };
        },
      };

      await reactStrategy.run(
        [{ role: "system", content: "Be helpful." }, { role: "user", content: "hi" }],
        { ...baseCtx, llm },
      );

      expect(captured[0]?.messages[0]?.content).toContain("Thought:");
      expect(captured[0]?.messages[0]?.content).toContain("Be helpful.");
    });
  });

  describe("planExecuteStrategy", () => {
    it("makes at least 3 LLM calls (plan + execute + synthesise)", async () => {
      let calls = 0;
      const llm: LLMClient = {
        name: "mock",
        async chat(req) {
          calls++;
          if (calls === 1) return { content: "1. Do thing", model: req.model, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
          if (calls === 2) return { content: "Did the thing", model: req.model, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
          return { content: "Final synthesis", model: req.model, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
        },
      };

      const result = await planExecuteStrategy.run(
        [{ role: "system", content: "test" }, { role: "user", content: "do something" }],
        { ...baseCtx, llm },
      );

      expect(calls).toBe(3);
      expect(result).toBe("Final synthesis");
    });
  });

  describe("ReflexionStrategy", () => {
    it("stops after maxReflections cycles even if not approved", async () => {
      const strategy = new ReflexionStrategy({ maxReflections: 1 });
      let calls = 0;
      const llm: LLMClient = {
        name: "mock",
        async chat(req) {
          calls++;
          if (calls === 1) return { content: "A long enough initial answer that exceeds the minimum threshold for reflexion checking.", model: req.model, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
          if (calls === 2) return { content: "REVISE: needs fixing", model: req.model, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
          return { content: "Revised answer that is the final output after the reflexion process.", model: req.model, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
        },
      };

      const result = await strategy.run(
        [{ role: "system", content: "test" }, { role: "user", content: "explain" }],
        { ...baseCtx, llm },
      );

      // maxReflections=1 so: initial + 1 critique + 1 revision = 3 calls
      expect(calls).toBe(3);
      expect(result).toContain("Revised answer");
    });
  });
});
