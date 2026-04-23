import { describe, it, expect } from "vitest";
import {
  PeerRegistry,
  type Address,
  type Peer,
  type Message,
} from "@corelay/mesh-core";
import {
  Hierarchy,
  LLMDecomposer,
  LLMMerger,
  type HierarchyWorker,
  type ResultMerger,
  type TaskDecomposer,
} from "../src/hierarchy.js";
import type { LLMClient, LLMRequest, LLMResponse } from "@corelay/mesh-core";

const workerA: HierarchyWorker = { address: "t/worker-a", role: "a" };
const workerB: HierarchyWorker = { address: "t/worker-b", role: "b" };

const scriptedDecomposer = (assignments: Map<Address, string>): TaskDecomposer => ({
  async decompose() {
    return assignments;
  },
});

const echoMerger: ResultMerger = {
  async merge({ results }) {
    return results.map((r) => `${r.worker.role}:${r.reply}`).join("|");
  },
};

const replyingWorker = (
  address: Address,
  reply: string | ((task: string) => string),
  collectorReply: (msg: Message, to: Address) => Promise<void>,
): Peer & { received: Message[] } => ({
  address,
  received: [],
  async send(m) {
    (this as unknown as { received: Message[] }).received.push(m);
    const text = typeof reply === "function" ? reply(m.content) : reply;
    const to = (m.metadata?.hierarchy as { collectorAddress: Address } | undefined)?.collectorAddress;
    if (!to) return;
    await collectorReply(
      {
        id: `${m.id}-reply`,
        from: address,
        to,
        kind: "peer",
        content: text,
        traceId: m.traceId,
        createdAt: Date.now(),
      },
      to,
    );
  },
});

describe("Hierarchy", () => {
  it("dispatches to assigned workers and merges their replies", async () => {
    const registry = new PeerRegistry();

    const wA = replyingWorker("t/worker-a", "I did A", async (m, to) => {
      await registry.deliver({ ...m, to });
    });
    const wB = replyingWorker("t/worker-b", "I did B", async (m, to) => {
      await registry.deliver({ ...m, to });
    });
    registry.register(wA);
    registry.register(wB);

    const assignments = new Map<Address, string>([
      ["t/worker-a", "handle A"],
      ["t/worker-b", "handle B"],
    ]);

    const hierarchy = new Hierarchy({
      workers: [workerA, workerB],
      registry,
      decomposer: scriptedDecomposer(assignments),
      merger: echoMerger,
      traceId: "trace-1",
      collectorAddress: "t/manager-collector",
    });

    const result = await hierarchy.run({ userMessage: "hello", from: "t/manager" });

    expect(result.missed).toHaveLength(0);
    expect(result.contributions).toHaveLength(2);
    expect(result.content).toContain("a:I did A");
    expect(result.content).toContain("b:I did B");

    // Workers received their assigned sub-tasks.
    expect(wA.received[0]?.content).toBe("handle A");
    expect(wB.received[0]?.content).toBe("handle B");
  });

  it("skips workers the decomposer did not assign", async () => {
    const registry = new PeerRegistry();

    const wA = replyingWorker("t/worker-a", "I did A", async (m, to) => {
      await registry.deliver({ ...m, to });
    });
    const wB = replyingWorker("t/worker-b", "I did B", async (m, to) => {
      await registry.deliver({ ...m, to });
    });
    registry.register(wA);
    registry.register(wB);

    const assignments = new Map<Address, string>([["t/worker-a", "only A"]]);

    const hierarchy = new Hierarchy({
      workers: [workerA, workerB],
      registry,
      decomposer: scriptedDecomposer(assignments),
      merger: echoMerger,
      traceId: "trace-2",
      collectorAddress: "t/manager-collector",
    });

    const result = await hierarchy.run({ userMessage: "hi", from: "t/manager" });

    expect(wA.received).toHaveLength(1);
    expect(wB.received).toHaveLength(0);
    expect(result.contributions).toHaveLength(1);
    expect(result.content).toBe("a:I did A");
  });

  it("reports timed-out workers as missed without blocking the merge", async () => {
    const registry = new PeerRegistry();

    const wA = replyingWorker("t/worker-a", "I did A", async (m, to) => {
      await registry.deliver({ ...m, to });
    });
    // wB never replies.
    const wB: Peer & { received: Message[] } = {
      address: "t/worker-b",
      received: [],
      async send(m) {
        (this as unknown as { received: Message[] }).received.push(m);
      },
    };
    registry.register(wA);
    registry.register(wB);

    const assignments = new Map<Address, string>([
      ["t/worker-a", "A"],
      ["t/worker-b", "B"],
    ]);

    const hierarchy = new Hierarchy({
      workers: [workerA, workerB],
      registry,
      decomposer: scriptedDecomposer(assignments),
      merger: echoMerger,
      traceId: "trace-3",
      collectorAddress: "t/manager-collector",
      timeoutMs: 50,
    });

    const result = await hierarchy.run({ userMessage: "hi", from: "t/manager" });

    expect(result.contributions.map((c) => c.worker.address)).toEqual(["t/worker-a"]);
    expect(result.missed.map((m) => m.worker.address)).toEqual(["t/worker-b"]);
    expect(result.content).toBe("a:I did A");
  });

  it("returns an empty-result merge when no workers are assigned", async () => {
    const registry = new PeerRegistry();
    const hierarchy = new Hierarchy({
      workers: [workerA],
      registry,
      decomposer: scriptedDecomposer(new Map()),
      merger: echoMerger,
      traceId: "trace-4",
      collectorAddress: "t/manager-collector",
    });

    const result = await hierarchy.run({ userMessage: "hi", from: "t/manager" });

    expect(result.contributions).toHaveLength(0);
    expect(result.missed).toHaveLength(0);
    expect(result.content).toBe("");
  });

  it("unregisters the collector after the run", async () => {
    const registry = new PeerRegistry();
    const hierarchy = new Hierarchy({
      workers: [workerA],
      registry,
      decomposer: scriptedDecomposer(new Map()),
      merger: echoMerger,
      traceId: "trace-5",
      collectorAddress: "t/manager-collector",
    });

    await hierarchy.run({ userMessage: "hi", from: "t/manager" });
    expect(registry.has("t/manager-collector")).toBe(false);
  });
});

describe("LLMDecomposer", () => {
  it("parses a JSON mapping and keeps only known worker addresses", async () => {
    const llm: LLMClient = {
      name: "mock",
      async chat(_req: LLMRequest): Promise<LLMResponse> {
        return {
          content: '{"t/worker-a": "do A", "t/worker-b": "do B", "t/unknown": "ignored"}',
          model: "m",
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: "stop",
        };
      },
    };
    const dec = new LLMDecomposer({ llm, model: "m", domain: "demo" });
    const assignments = await dec.decompose({
      userMessage: "hi",
      workers: [workerA, workerB],
    });

    expect(assignments.get("t/worker-a")).toBe("do A");
    expect(assignments.get("t/worker-b")).toBe("do B");
    expect(assignments.has("t/unknown" as Address)).toBe(false);
  });

  it("returns an empty map on malformed JSON", async () => {
    const llm: LLMClient = {
      name: "mock",
      async chat() {
        return {
          content: "sorry, not JSON",
          model: "m",
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: "stop",
        };
      },
    };
    const dec = new LLMDecomposer({ llm, model: "m", domain: "demo" });
    const assignments = await dec.decompose({
      userMessage: "hi",
      workers: [workerA],
    });
    expect(assignments.size).toBe(0);
  });
});

describe("LLMMerger", () => {
  it("short-circuits to a default when there are no results", async () => {
    const llm: LLMClient = {
      name: "mock",
      async chat(): Promise<LLMResponse> {
        throw new Error("should not be called");
      },
    };
    const merger = new LLMMerger({ llm, model: "m", domain: "demo" });
    const out = await merger.merge({ userMessage: "hi", results: [] });
    expect(out).toMatch(/enough information/i);
  });

  it("asks the LLM to combine when there are results", async () => {
    let seenPrompt = "";
    const llm: LLMClient = {
      name: "mock",
      async chat(req) {
        seenPrompt = req.messages.map((m) => m.content).join("\n");
        return {
          content: "merged answer",
          model: "m",
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: "stop",
        };
      },
    };
    const merger = new LLMMerger({ llm, model: "m", domain: "demo" });
    const out = await merger.merge({
      userMessage: "hi",
      results: [{ worker: workerA, reply: "reply A" }],
    });
    expect(out).toBe("merged answer");
    expect(seenPrompt).toContain("reply A");
  });
});
