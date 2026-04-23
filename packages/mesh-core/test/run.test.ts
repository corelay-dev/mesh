import { describe, it, expect } from "vitest";
import { Agent } from "../src/agent.js";
import { MemoryInbox } from "../src/memory-inbox.js";
import { PeerRegistry } from "../src/peer-registry.js";
import { run } from "../src/run.js";
import type { AgentConfig } from "../src/agent-config.js";
import type { LLMClient } from "../src/llm.js";

const echoLLM: LLMClient = {
  name: "mock",
  async chat(req) {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    return {
      content: `echo: ${lastUser?.content ?? ""}`,
      model: req.model,
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: "stop",
    };
  },
};

// Agent must be able to reply to any ephemeral caller address, so the test
// uses a permissive config. The real guard against rogue peer sends is the
// operator-authored capability list — exercised in agent.test.ts.
const permissiveConfig: AgentConfig = {
  name: "hello",
  description: "",
  prompt: "You are helpful.",
  model: "gpt-4o-mini",
  maxResponseTokens: 100,
  welcomeMessage: "",
  guardrails: "",
  tools: [],
  capabilities: [],
};

describe("run()", () => {
  it("sends a user message and returns the first reply", async () => {
    const registry = new PeerRegistry();
    const agent = new Agent("demo/hello", permissiveConfig, echoLLM, new MemoryInbox(), registry);

    // Pre-authorise the ephemeral caller address by using a fixed `from`.
    const callerAddress = "demo/caller";
    const configWithReplyCap: AgentConfig = {
      ...permissiveConfig,
      capabilities: [{ kind: "peer", address: callerAddress }],
    };
    const replyingAgent = new Agent("demo/hello", configWithReplyCap, echoLLM, new MemoryInbox(), registry);
    registry.register(replyingAgent);
    await replyingAgent.start();

    const result = await run(registry, "demo/hello", "ping", { from: callerAddress, timeoutMs: 2_000 });

    expect(result.content).toBe("echo: ping");
    expect(result.traceId).toBeDefined();
    // The setup-only agent shouldn't interfere; keep the lint happy:
    void agent;
  });

  it("rejects on timeout when the root peer never replies", async () => {
    const registry = new PeerRegistry();
    // Register a silent peer that accepts but never replies.
    registry.register({
      address: "demo/silent",
      async send() {
        // Swallow. No reply ever.
      },
    });

    await expect(
      run(registry, "demo/silent", "hello", { timeoutMs: 100 }),
    ).rejects.toThrow(/timed out/i);
  });
});
