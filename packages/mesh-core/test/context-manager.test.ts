import { describe, it, expect, vi } from "vitest";
import { ContextManager, type CompactionEvent, type ContextSummariser } from "../src/context-manager.js";
import type { LLMMessage } from "../src/llm.js";

const stubSummariser: ContextSummariser = async (messages) =>
  `Summary of ${messages.length} messages`;

const buildConversation = (turnCount: number): LLMMessage[] => {
  const messages: LLMMessage[] = [
    { role: "system", content: "You are helpful." },
  ];
  for (let i = 0; i < turnCount; i++) {
    messages.push({ role: "user", content: `Question ${i}` });
    messages.push({ role: "assistant", content: `Answer ${i}` });
  }
  return messages;
};

describe("ContextManager", () => {
  it("passes messages through unchanged when within token budget", async () => {
    const manager = new ContextManager(stubSummariser, {
      maxTokenBudget: 10000,
      avgTokensPerMessage: 100,
      clearOldToolResults: false,
    });

    const messages = buildConversation(3); // 7 messages * 100 = 700 tokens
    const result = await manager.compact("s1", messages);

    expect(result).toEqual(messages);
  });

  it("summarises older turns when over budget", async () => {
    const manager = new ContextManager(stubSummariser, {
      maxTokenBudget: 1000,
      avgTokensPerMessage: 150,
      preserveRecentCount: 4,
      clearOldToolResults: false,
    });

    // 21 messages * 150 = 3150 tokens (over 1000 budget)
    const messages = buildConversation(10);
    const result = await manager.compact("s1", messages);

    // Should have: system + summary + 4 recent messages
    expect(result.length).toBe(6);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("You are helpful.");
    expect(result[1].role).toBe("system");
    expect(result[1].content).toContain("Conversation summary");
    expect(result[1].content).toContain("16 messages");
  });

  it("emits compaction event with correct metadata", async () => {
    const events: CompactionEvent[] = [];
    const manager = new ContextManager(stubSummariser, {
      maxTokenBudget: 500,
      avgTokensPerMessage: 150,
      preserveRecentCount: 2,
      clearOldToolResults: false,
    });
    manager.onCompaction((e) => events.push(e));

    const messages = buildConversation(5); // 11 messages
    await manager.compact("session-42", messages);

    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe("session-42");
    expect(events[0].originalCount).toBe(11);
    expect(events[0].summary).toContain("8 messages");
  });

  it("clears old tool results when enabled", async () => {
    const manager = new ContextManager(stubSummariser, {
      maxTokenBudget: 50000, // high budget so no summarisation
      avgTokensPerMessage: 100,
      clearOldToolResults: true,
      toolResultClearThreshold: 2,
    });

    const messages: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "calling tool", toolCalls: [{ id: "t1", name: "fetch", arguments: {} }] },
      { role: "tool", content: "big result data here", toolCallId: "t1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "final answer" },
    ];

    const result = await manager.compact("s1", messages);

    // Tool result at index 3 is beyond threshold (6 - 2 = 4, index 3 < 4)
    expect(result[3].content).toBe("[tool result cleared — re-fetchable]");
    expect(result[3].toolCallId).toBe("t1");
    // Recent messages preserved
    expect(result[4].content).toBe("q2");
    expect(result[5].content).toBe("final answer");
  });

  it("preserves tool results within threshold", async () => {
    const manager = new ContextManager(stubSummariser, {
      maxTokenBudget: 50000,
      avgTokensPerMessage: 100,
      clearOldToolResults: true,
      toolResultClearThreshold: 10,
    });

    const messages: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "tool", content: "recent tool output", toolCallId: "t1" },
      { role: "user", content: "q" },
    ];

    const result = await manager.compact("s1", messages);
    // All within threshold — nothing cleared
    expect(result[1].content).toBe("recent tool output");
  });

  it("unsubscribes listener correctly", async () => {
    const events: CompactionEvent[] = [];
    const manager = new ContextManager(stubSummariser, {
      maxTokenBudget: 100,
      avgTokensPerMessage: 150,
      preserveRecentCount: 2,
      clearOldToolResults: false,
    });

    const unsub = manager.onCompaction((e) => events.push(e));
    await manager.compact("s1", buildConversation(5));
    expect(events).toHaveLength(1);

    unsub();
    await manager.compact("s2", buildConversation(5));
    expect(events).toHaveLength(1); // No new event
  });

  it("does not compact when all messages are within preserveRecentCount", async () => {
    const manager = new ContextManager(stubSummariser, {
      maxTokenBudget: 100,
      avgTokensPerMessage: 150,
      preserveRecentCount: 20,
      clearOldToolResults: false,
    });

    const messages = buildConversation(3); // system + 6 = 7 messages
    const result = await manager.compact("s1", messages);

    // Cannot compact — all conversation messages fit in preserve window
    expect(result).toEqual(messages);
  });
});
