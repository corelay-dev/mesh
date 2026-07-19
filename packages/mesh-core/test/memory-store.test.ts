import { describe, it, expect } from "vitest";
import {
  Agent,
  MemoryInbox,
  PeerRegistry,
  InMemoryMemoryStore,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
  type Address,
  type Message,
  type MemoryStore,
  type MemoryEntry,
  type MemoryRecall,
  type MemoryRetrieveOptions,
} from "../src/index.js";

function createCapturingLLM(): { llm: LLMClient; getMessages: () => LLMRequest["messages"][] } {
  const captured: LLMRequest["messages"][] = [];
  const llm: LLMClient = {
    name: "mock-capture",
    async chat(request: LLMRequest): Promise<LLMResponse> {
      captured.push([...request.messages]);
      return {
        content: "Response from agent",
        model: "mock",
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
      };
    },
  };
  return { llm, getMessages: () => captured };
}

function makeMessage(content: string, from: Address = "test/user", to: Address = "test/agent"): Message {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    from,
    to,
    kind: "peer",
    content,
    traceId: "session-1",
    createdAt: Date.now(),
  };
}

describe("InMemoryMemoryStore", () => {
  it("stores and retrieves entries by keyword overlap", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({ kind: "semantic", content: "The user prefers dark mode" });
    await store.write({ kind: "semantic", content: "API rate limit is 100 req/s" });
    await store.write({ kind: "episodic", content: "User asked about deployment" });

    const results = await store.retrieveRelevant("dark mode settings", 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("dark mode");
    expect(results[0]!.kind).toBe("semantic");
  });

  it("filters by namespace", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({ kind: "semantic", content: "alpha fact", namespace: "agent-a" });
    await store.write({ kind: "semantic", content: "alpha data", namespace: "agent-b" });

    const results = await store.retrieveRelevant("alpha", 10, { namespace: "agent-a" });
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("alpha fact");
  });

  it("filters by entry kind", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({ kind: "episodic", content: "conversation about testing" });
    await store.write({ kind: "semantic", content: "testing best practices" });

    const results = await store.retrieveRelevant("testing", 10, { kind: "semantic" });
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("semantic");
  });

  it("respects k limit", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({ kind: "semantic", content: "fact one about dogs" });
    await store.write({ kind: "semantic", content: "fact two about dogs" });
    await store.write({ kind: "semantic", content: "fact three about dogs" });

    const results = await store.retrieveRelevant("dogs", 2);
    expect(results).toHaveLength(2);
  });

  it("respects minScore threshold", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({ kind: "semantic", content: "completely unrelated content xyz" });
    await store.write({ kind: "semantic", content: "the query matches exactly the query" });

    const results = await store.retrieveRelevant("the query", 10, { minScore: 0.5 });
    // Only the highly matching entry should pass
    expect(results.every((r) => r.score >= 0.5)).toBe(true);
  });

  it("returns empty for no matches", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({ kind: "semantic", content: "alpha beta gamma" });

    const results = await store.retrieveRelevant("zzzzz", 5);
    expect(results).toHaveLength(0);
  });
});

describe("Agent with MemoryStore integration", () => {
  it("retrieves memories and injects them into context", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({
      kind: "semantic",
      content: "User prefers concise responses",
      namespace: "test/agent",
    });

    const { llm, getMessages } = createCapturingLLM();
    const inbox = new MemoryInbox();
    const registry = new PeerRegistry();

    const replyInbox = new MemoryInbox();
    registry.register({
      address: "test/user" as Address,
      start: async () => {},
      send: async (m) => replyInbox.append(m),
    });

    const agent = new Agent(
      "test/agent" as Address,
      {
        name: "test-agent",
        model: "mock",
        prompt: "You are helpful.",
        maxResponseTokens: 100,
        capabilities: [{ kind: "peer", address: "test/user" as Address }],
        tools: [],
      },
      llm,
      inbox,
      registry,
      { memoryStore: store },
    );

    await agent.start();
    // Use keywords that overlap with the stored memory ("user", "prefers", "concise", "responses")
    await inbox.append(makeMessage("The user prefers concise answers"));

    // Allow async processing
    await new Promise((r) => setTimeout(r, 50));

    const messages = getMessages();
    expect(messages.length).toBe(1);

    const llmInput = messages[0]!;
    expect(llmInput[0]!.role).toBe("system");
    expect(llmInput[0]!.content).toBe("You are helpful.");

    // Memory recall injected as second system message
    const memoryMsg = llmInput.find(
      (m) => m.role === "system" && m.content.includes("Relevant memories"),
    );
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg!.content).toContain("concise responses");
  });

  it("writes salient turns to memory after responding", async () => {
    const store = new InMemoryMemoryStore();
    const { llm } = createCapturingLLM();
    const inbox = new MemoryInbox();
    const registry = new PeerRegistry();

    const replyInbox = new MemoryInbox();
    registry.register({
      address: "test/user" as Address,
      start: async () => {},
      send: async (m) => replyInbox.append(m),
    });

    const agent = new Agent(
      "test/agent" as Address,
      {
        name: "test-agent",
        model: "mock",
        prompt: "You are helpful.",
        maxResponseTokens: 100,
        capabilities: [{ kind: "peer", address: "test/user" as Address }],
        tools: [],
      },
      llm,
      inbox,
      registry,
      { memoryStore: store },
    );

    await agent.start();
    await inbox.append(makeMessage("What is the capital of France?"));

    await new Promise((r) => setTimeout(r, 50));

    // The agent should have written the exchange to memory
    const entries = store.storedEntries;
    expect(entries.length).toBe(1);
    expect(entries[0]!.kind).toBe("episodic");
    expect(entries[0]!.content).toContain("capital of France");
    expect(entries[0]!.content).toContain("Response from agent");
    expect(entries[0]!.namespace).toBe("test/agent");
  });

  it("does not inject memories when memoryStore is not configured", async () => {
    const { llm, getMessages } = createCapturingLLM();
    const inbox = new MemoryInbox();
    const registry = new PeerRegistry();

    registry.register({
      address: "test/user" as Address,
      start: async () => {},
      send: async () => {},
    });

    const agent = new Agent(
      "test/agent" as Address,
      {
        name: "test-agent",
        model: "mock",
        prompt: "You are helpful.",
        maxResponseTokens: 100,
        capabilities: [{ kind: "peer", address: "test/user" as Address }],
        tools: [],
      },
      llm,
      inbox,
      registry,
      {}, // No memoryStore — default behaviour
    );

    await agent.start();
    await inbox.append(makeMessage("Hello"));

    await new Promise((r) => setTimeout(r, 50));

    const messages = getMessages();
    const llmInput = messages[0]!;
    // Only system prompt + user message, no memory injection
    expect(llmInput).toHaveLength(2);
    expect(llmInput[0]!.role).toBe("system");
    expect(llmInput[1]!.role).toBe("user");
  });

  it("scopes memory to custom namespace when provided", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({
      kind: "semantic",
      content: "Custom namespace fact",
      namespace: "custom-ns",
    });
    await store.write({
      kind: "semantic",
      content: "Default namespace fact",
      namespace: "test/agent",
    });

    const { llm, getMessages } = createCapturingLLM();
    const inbox = new MemoryInbox();
    const registry = new PeerRegistry();

    registry.register({
      address: "test/user" as Address,
      start: async () => {},
      send: async () => {},
    });

    const agent = new Agent(
      "test/agent" as Address,
      {
        name: "test-agent",
        model: "mock",
        prompt: "You are helpful.",
        maxResponseTokens: 100,
        capabilities: [{ kind: "peer", address: "test/user" as Address }],
        tools: [],
      },
      llm,
      inbox,
      registry,
      { memoryStore: store, memoryNamespace: "custom-ns" },
    );

    await agent.start();
    await inbox.append(makeMessage("Tell me the namespace fact"));

    await new Promise((r) => setTimeout(r, 50));

    const messages = getMessages();
    const memoryMsg = messages[0]!.find(
      (m) => m.role === "system" && m.content.includes("Relevant memories"),
    );
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg!.content).toContain("Custom namespace fact");
    expect(memoryMsg!.content).not.toContain("Default namespace fact");
  });
});
