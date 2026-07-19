import { describe, it, expect, vi } from "vitest";
import { ParallelToolExecutor } from "../src/parallel-tool-executor.js";
import { ToolRegistry } from "../src/tool-executor.js";
import type { ToolCall } from "../src/tool.js";

describe("ParallelToolExecutor", () => {
  it("executes a single call via the inner executor", async () => {
    const inner = new ToolRegistry({
      greet: async (args) => `Hello, ${args.name}!`,
    });
    const parallel = new ParallelToolExecutor(inner);

    const result = await parallel.execute({ id: "c1", name: "greet", arguments: { name: "Deji" } });
    expect(result.toolCallId).toBe("c1");
    expect(result.content).toBe("Hello, Deji!");
  });

  it("executes multiple calls concurrently and returns results in order", async () => {
    const order: string[] = [];
    const inner = new ToolRegistry({
      slow: async (args) => {
        const delay = Number(args.delay);
        await new Promise((r) => setTimeout(r, delay));
        order.push(String(args.id));
        return `done-${args.id}`;
      },
    });
    const parallel = new ParallelToolExecutor(inner, { concurrency: 3 });

    const calls: ToolCall[] = [
      { id: "c1", name: "slow", arguments: { id: "1", delay: 30 } },
      { id: "c2", name: "slow", arguments: { id: "2", delay: 10 } },
      { id: "c3", name: "slow", arguments: { id: "3", delay: 20 } },
    ];

    const results = await parallel.executeAll(calls);

    // Results are in positional order regardless of completion time
    expect(results[0].toolCallId).toBe("c1");
    expect(results[0].content).toBe("done-1");
    expect(results[1].toolCallId).toBe("c2");
    expect(results[1].content).toBe("done-2");
    expect(results[2].toolCallId).toBe("c3");
    expect(results[2].content).toBe("done-3");
  });

  it("respects concurrency limit", async () => {
    let activeCalls = 0;
    let maxConcurrent = 0;

    const inner = new ToolRegistry({
      tracked: async () => {
        activeCalls++;
        maxConcurrent = Math.max(maxConcurrent, activeCalls);
        await new Promise((r) => setTimeout(r, 10));
        activeCalls--;
        return "ok";
      },
    });
    const parallel = new ParallelToolExecutor(inner, { concurrency: 2 });

    const calls: ToolCall[] = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      name: "tracked",
      arguments: {},
    }));

    await parallel.executeAll(calls);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(maxConcurrent).toBeGreaterThan(0);
  });

  it("returns empty array for empty input", async () => {
    const inner = new ToolRegistry();
    const parallel = new ParallelToolExecutor(inner);

    const results = await parallel.executeAll([]);
    expect(results).toEqual([]);
  });

  it("handles errors within individual calls without failing the batch", async () => {
    const inner = new ToolRegistry({
      ok: async () => "success",
      fail: async () => { throw new Error("boom"); },
    });
    const parallel = new ParallelToolExecutor(inner, { concurrency: 5 });

    const calls: ToolCall[] = [
      { id: "c1", name: "ok", arguments: {} },
      { id: "c2", name: "fail", arguments: {} },
      { id: "c3", name: "ok", arguments: {} },
    ];

    const results = await parallel.executeAll(calls);

    expect(results[0].content).toBe("success");
    expect(results[0].error).toBeUndefined();
    expect(results[1].error).toBe(true);
    expect(results[1].content).toContain("boom");
    expect(results[2].content).toBe("success");
  });

  it("defaults to concurrency of 5", async () => {
    let activeCalls = 0;
    let maxConcurrent = 0;

    const inner = new ToolRegistry({
      tracked: async () => {
        activeCalls++;
        maxConcurrent = Math.max(maxConcurrent, activeCalls);
        await new Promise((r) => setTimeout(r, 5));
        activeCalls--;
        return "ok";
      },
    });
    const parallel = new ParallelToolExecutor(inner);

    const calls: ToolCall[] = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      name: "tracked",
      arguments: {},
    }));

    await parallel.executeAll(calls);
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});
