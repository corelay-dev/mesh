import { describe, it, expect } from "vitest";
import { Agent } from "../src/agent.js";
import { MemoryInbox } from "../src/memory-inbox.js";
import { PeerRegistry } from "../src/peer-registry.js";
import type { AgentConfig } from "../src/agent-config.js";
import type { LLMClient } from "../src/llm.js";
import type { Message } from "../src/message.js";
import type { Peer } from "../src/peer.js";

const echo = (prefix: string): LLMClient => ({
  name: "mock",
  async chat(req) {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    return {
      content: `${prefix}: ${lastUser?.content ?? ""}`,
      model: req.model,
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: "stop",
    };
  },
});

const agentConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: "test",
  description: "",
  prompt: "",
  model: "gpt-4o-mini",
  maxResponseTokens: 100,
  welcomeMessage: "",
  guardrails: "",
  tools: [],
  capabilities: [],
  ...overrides,
});

const sinkPeer = (address: `${string}/${string}`): Peer & { received: Message[] } => ({
  address,
  received: [],
  async send(m) {
    (this as unknown as { received: Message[] }).received.push(m);
  },
});

const drain = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe("two agents via PeerRegistry", () => {
  it("Agent A forwards a reply to a second addressable peer B", async () => {
    const registry = new PeerRegistry();
    const b = sinkPeer("test/b");
    registry.register(b);

    const a = new Agent(
      "test/a",
      agentConfig({
        prompt: "You are A.",
        capabilities: [{ kind: "peer", address: "test/b" }],
      }),
      echo("A"),
      new MemoryInbox(),
      registry,
    );
    registry.register(a);
    await a.start();

    // An inbound message to A arrives "from" B; A's reply routes to B via the
    // registry, because B's address matches A's one granted peer capability.
    await a.send({
      id: "m-1",
      from: "test/b",
      to: "test/a",
      kind: "user",
      content: "ping",
      traceId: "t-1",
      createdAt: 0,
    });

    await drain();

    expect(b.received).toHaveLength(1);
    expect(b.received[0]?.content).toBe("A: ping");
    expect(b.received[0]?.from).toBe("test/a");
    expect(b.received[0]?.to).toBe("test/b");
    expect(b.received[0]?.kind).toBe("assistant");
    expect(b.received[0]?.traceId).toBe("t-1");
  });

  it("two independent agents route replies to independent peers", async () => {
    const registry = new PeerRegistry();
    const sinkForA = sinkPeer("test/human-a");
    const sinkForB = sinkPeer("test/human-b");
    registry.register(sinkForA);
    registry.register(sinkForB);

    const agentA = new Agent(
      "test/a",
      agentConfig({
        prompt: "You are A.",
        capabilities: [{ kind: "peer", address: "test/human-a" }],
      }),
      echo("A"),
      new MemoryInbox(),
      registry,
    );
    const agentB = new Agent(
      "test/b",
      agentConfig({
        prompt: "You are B.",
        capabilities: [{ kind: "peer", address: "test/human-b" }],
      }),
      echo("B"),
      new MemoryInbox(),
      registry,
    );
    registry.register(agentA);
    registry.register(agentB);
    await agentA.start();
    await agentB.start();

    await agentA.send({
      id: "m-a",
      from: "test/human-a",
      to: "test/a",
      kind: "user",
      content: "hi-a",
      traceId: "t-a",
      createdAt: 0,
    });
    await agentB.send({
      id: "m-b",
      from: "test/human-b",
      to: "test/b",
      kind: "user",
      content: "hi-b",
      traceId: "t-b",
      createdAt: 0,
    });

    await drain();

    expect(sinkForA.received).toHaveLength(1);
    expect(sinkForA.received[0]?.content).toBe("A: hi-a");
    expect(sinkForA.received[0]?.from).toBe("test/a");

    expect(sinkForB.received).toHaveLength(1);
    expect(sinkForB.received[0]?.content).toBe("B: hi-b");
    expect(sinkForB.received[0]?.from).toBe("test/b");
  });
});
