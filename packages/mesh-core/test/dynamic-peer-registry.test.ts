import { describe, it, expect, vi } from "vitest";
import {
  DynamicPeerRegistry,
  DynamicPeerNotFoundError,
  spawnPeer,
  type PeerEvent,
} from "../src/dynamic-peer-registry.js";
import type { Peer } from "../src/peer.js";
import type { Message } from "../src/message.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/llm.js";
import type { AgentConfig } from "../src/agent-config.js";

const mkPeer = (address: `${string}/${string}`): Peer & { received: Message[] } => ({
  address,
  received: [],
  async send(m) {
    this.received.push(m);
  },
});

const msg = (to: `${string}/${string}`): Message => ({
  id: "m-1",
  from: "test/sender",
  to,
  kind: "peer",
  content: "hi",
  traceId: "t-1",
  createdAt: Date.now(),
});

describe("DynamicPeerRegistry", () => {
  it("registers and delivers to peers", async () => {
    const registry = new DynamicPeerRegistry();
    const peer = mkPeer("test/alice");
    registry.register(peer);

    await registry.deliver(msg("test/alice"));
    expect(peer.received).toHaveLength(1);
  });

  it("throws DynamicPeerNotFoundError for unknown targets", async () => {
    const registry = new DynamicPeerRegistry();
    await expect(registry.deliver(msg("test/nobody"))).rejects.toBeInstanceOf(DynamicPeerNotFoundError);
  });

  it("emits 'registered' event on register", () => {
    const registry = new DynamicPeerRegistry();
    const events: PeerEvent[] = [];
    registry.onPeerChange((e) => events.push(e));

    const peer = mkPeer("test/alice");
    registry.register(peer);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("registered");
    expect(events[0].address).toBe("test/alice");
  });

  it("emits 'unregistered' event on unregister", () => {
    const registry = new DynamicPeerRegistry();
    const events: PeerEvent[] = [];
    const peer = mkPeer("test/alice");
    registry.register(peer);

    registry.onPeerChange((e) => events.push(e));
    registry.unregister("test/alice");

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("unregistered");
    expect(events[0].address).toBe("test/alice");
  });

  it("unregister returns false for non-existent peer", () => {
    const registry = new DynamicPeerRegistry();
    expect(registry.unregister("test/nobody")).toBe(false);
  });

  it("unregister returns true for existing peer", () => {
    const registry = new DynamicPeerRegistry();
    registry.register(mkPeer("test/alice"));
    expect(registry.unregister("test/alice")).toBe(true);
  });

  it("does not emit unregistered event for non-existent peer", () => {
    const registry = new DynamicPeerRegistry();
    const events: PeerEvent[] = [];
    registry.onPeerChange((e) => events.push(e));

    registry.unregister("test/nobody");
    expect(events).toHaveLength(0);
  });

  it("lists all registered addresses", () => {
    const registry = new DynamicPeerRegistry();
    registry.register(mkPeer("test/alice"));
    registry.register(mkPeer("test/bob"));

    const addresses = registry.list();
    expect(addresses).toContain("test/alice");
    expect(addresses).toContain("test/bob");
    expect(addresses).toHaveLength(2);
  });

  it("reports correct size", () => {
    const registry = new DynamicPeerRegistry();
    expect(registry.size).toBe(0);

    registry.register(mkPeer("test/alice"));
    expect(registry.size).toBe(1);

    registry.register(mkPeer("test/bob"));
    expect(registry.size).toBe(2);

    registry.unregister("test/alice");
    expect(registry.size).toBe(1);
  });

  it("unsubscribes listener correctly", () => {
    const registry = new DynamicPeerRegistry();
    const events: PeerEvent[] = [];
    const unsub = registry.onPeerChange((e) => events.push(e));

    registry.register(mkPeer("test/alice"));
    expect(events).toHaveLength(1);

    unsub();
    registry.register(mkPeer("test/bob"));
    expect(events).toHaveLength(1); // No new event
  });
});

describe("spawnPeer", () => {
  const stubLlm: LLMClient = {
    name: "stub",
    async chat(req: LLMRequest): Promise<LLMResponse> {
      return {
        content: "hello from spawned agent",
        model: req.model,
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
      };
    },
  };

  const stubConfig: AgentConfig = {
    name: "spawned-agent",
    description: "A dynamically spawned agent",
    prompt: "You are a helper.",
    model: "test-model",
    maxResponseTokens: 100,
    welcomeMessage: "hi",
    guardrails: "",
    tools: [],
    capabilities: [{ kind: "peer", address: "test/sender" }],
  };

  it("spawns an agent and registers it in the dynamic registry", async () => {
    const registry = new DynamicPeerRegistry();
    const sender = mkPeer("test/sender");
    registry.register(sender);

    const events: PeerEvent[] = [];
    registry.onPeerChange((e) => events.push(e));

    const agent = await spawnPeer(registry, "test/spawned", {
      config: stubConfig,
      llm: stubLlm,
    });

    expect(registry.has("test/spawned")).toBe(true);
    expect(agent.address).toBe("test/spawned");
    expect(events.some((e) => e.kind === "registered" && e.address === "test/spawned")).toBe(true);
  });

  it("spawned agent processes messages and replies via registry", async () => {
    const registry = new DynamicPeerRegistry();
    const sender = mkPeer("test/sender");
    registry.register(sender);

    await spawnPeer(registry, "test/spawned", {
      config: stubConfig,
      llm: stubLlm,
    });

    // Send a message to the spawned agent
    await registry.deliver({
      id: "m-spawn-1",
      from: "test/sender",
      to: "test/spawned",
      kind: "user",
      content: "hello",
      traceId: "trace-1",
      createdAt: Date.now(),
    });

    // Allow async processing
    await new Promise((r) => setTimeout(r, 50));

    // The spawned agent should have replied to sender
    expect(sender.received.length).toBeGreaterThanOrEqual(1);
    expect(sender.received[0].from).toBe("test/spawned");
    expect(sender.received[0].content).toBe("hello from spawned agent");
  });
});
