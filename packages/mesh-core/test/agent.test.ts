import { describe, it, expect } from "vitest";
import { Agent, CapabilityError } from "../src/agent.js";
import { MemoryInbox } from "../src/memory-inbox.js";
import { PeerRegistry } from "../src/peer-registry.js";
import type { AgentConfig } from "../src/agent-config.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/llm.js";
import type { Message } from "../src/message.js";
import type { Peer } from "../src/peer.js";

const mockLLM = (reply: string): LLMClient => ({
  name: "mock",
  async chat(req: LLMRequest): Promise<LLMResponse> {
    return {
      content: reply,
      model: req.model,
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: "stop",
    };
  },
});

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

const msg = (content: string, from: `${string}/${string}` = "test/user"): Message => ({
  id: "m-1",
  from,
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

describe("Agent", () => {
  it("delivers its reply back to the sender via the registry", async () => {
    const registry = new PeerRegistry();
    const user = sinkPeer("test/user");
    registry.register(user);

    const agent = new Agent("test/agent", baseConfig, mockLLM("hello back"), new MemoryInbox(), registry);
    registry.register(agent);
    await agent.start();

    await agent.send(msg("hello"));
    await new Promise((r) => setImmediate(r));

    expect(user.received).toHaveLength(1);
    expect(user.received[0]?.content).toBe("hello back");
    expect(user.received[0]?.from).toBe("test/agent");
    expect(user.received[0]?.to).toBe("test/user");
    expect(user.received[0]?.kind).toBe("assistant");
    expect(user.received[0]?.traceId).toBe("t-1");
  });

  it("passes the system prompt and user message to the LLM", async () => {
    const captured: LLMRequest[] = [];
    const llm: LLMClient = {
      name: "mock",
      async chat(req) {
        captured.push(req);
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
    registry.register(sinkPeer("test/user"));
    const agent = new Agent(
      "test/agent",
      { ...baseConfig, prompt: "Be concise." },
      llm,
      new MemoryInbox(),
      registry,
    );
    registry.register(agent);
    await agent.start();

    await agent.send(msg("hello"));
    await new Promise((r) => setImmediate(r));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hello" },
    ]);
    expect(captured[0]?.model).toBe("gpt-4o-mini");
    expect(captured[0]?.maxTokens).toBe(100);
  });

  describe("capability enforcement", () => {
    it("does not deliver a reply when the target peer is not in capabilities", async () => {
      const registry = new PeerRegistry();
      const stranger = sinkPeer("test/stranger");
      registry.register(stranger);

      const configWithoutCap: AgentConfig = { ...baseConfig, capabilities: [] };
      const agent = new Agent(
        "test/agent",
        configWithoutCap,
        mockLLM("secret"),
        new MemoryInbox(),
        registry,
      );
      registry.register(agent);
      await agent.start();

      await agent.send(msg("hi", "test/stranger"));
      await new Promise((r) => setImmediate(r));

      // Capability-less reply is blocked — stranger never receives anything.
      expect(stranger.received).toHaveLength(0);
    });

    it("allows replies when a matching PeerCapability is granted", async () => {
      const registry = new PeerRegistry();
      const stranger = sinkPeer("test/stranger");
      registry.register(stranger);

      const config: AgentConfig = {
        ...baseConfig,
        capabilities: [{ kind: "peer", address: "test/stranger" }],
      };
      const agent = new Agent("test/agent", config, mockLLM("ok"), new MemoryInbox(), registry);
      registry.register(agent);
      await agent.start();

      await agent.send(msg("hi", "test/stranger"));
      await new Promise((r) => setImmediate(r));

      expect(stranger.received).toHaveLength(1);
      expect(stranger.received[0]?.content).toBe("ok");
    });

    it("throws CapabilityError with agent and target addresses", () => {
      const err = new CapabilityError("test/agent", "test/stranger");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CapabilityError");
      expect(err.agent).toBe("test/agent");
      expect(err.target).toBe("test/stranger");
      expect(err.message).toContain("test/agent");
      expect(err.message).toContain("test/stranger");
    });
  });
});
