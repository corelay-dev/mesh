import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgresConversationMemory } from "../src/conversation-memory.js";
import type { Pool } from "pg";

/**
 * Creates a mock pg Pool that simulates the conversation_messages table
 * using an in-memory array. No Docker required.
 */
function createMockPool() {
  let seq = 0;
  const rows: Array<{
    seq: number;
    session_id: string;
    role: string;
    content: string;
    tool_call_id: string | null;
    tool_calls: string | null;
    created_at: number;
  }> = [];

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const sqlLower = sql.toLowerCase().trim();

    if (sqlLower.startsWith("insert into")) {
      const [sessionId, role, content, toolCallId, toolCalls, createdAt] = params as [
        string, string, string, string | null, string | null, number,
      ];
      rows.push({
        seq: ++seq,
        session_id: sessionId,
        role,
        content,
        tool_call_id: toolCallId,
        tool_calls: toolCalls,
        created_at: createdAt,
      });
      return { rows: [], rowCount: 1 };
    }

    if (sqlLower.startsWith("select")) {
      const [sessionId, limit] = params as [string, number];
      const sessionRows = rows
        .filter((r) => r.session_id === sessionId)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit);
      return { rows: sessionRows, rowCount: sessionRows.length };
    }

    if (sqlLower.startsWith("delete from")) {
      if (sqlLower.includes("not in") || sqlLower.includes("seq not in")) {
        // Prune query — keep only the last N per session
        const [sessionId, maxKeep] = params as [string, number];
        const sessionRows = rows
          .filter((r) => r.session_id === sessionId)
          .sort((a, b) => b.seq - a.seq);
        const toKeep = new Set(sessionRows.slice(0, maxKeep).map((r) => r.seq));
        // Remove rows not in keep set
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]!.session_id === sessionId && !toKeep.has(rows[i]!.seq)) {
            rows.splice(i, 1);
          }
        }
      } else {
        // Simple delete by session_id
        const [sessionId] = params as [string];
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]!.session_id === sessionId) {
            rows.splice(i, 1);
          }
        }
      }
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  });

  return { pool: { query } as unknown as Pool, rows, query };
}

describe("PostgresConversationMemory", () => {
  let mockPool: ReturnType<typeof createMockPool>;
  let memory: PostgresConversationMemory;

  beforeEach(() => {
    mockPool = createMockPool();
    memory = new PostgresConversationMemory({ pool: mockPool.pool });
  });

  it("appends a message and retrieves it", async () => {
    await memory.append("session-1", { role: "user", content: "Hello" });
    await memory.append("session-1", { role: "assistant", content: "Hi there" });

    const history = await memory.getHistory("session-1");
    expect(history).toHaveLength(2);
    expect(history[0]!.role).toBe("user");
    expect(history[0]!.content).toBe("Hello");
    expect(history[1]!.role).toBe("assistant");
    expect(history[1]!.content).toBe("Hi there");
  });

  it("returns messages in chronological order", async () => {
    await memory.append("session-1", { role: "user", content: "First" });
    await memory.append("session-1", { role: "assistant", content: "Second" });
    await memory.append("session-1", { role: "user", content: "Third" });

    const history = await memory.getHistory("session-1");
    expect(history.map((m) => m.content)).toEqual(["First", "Second", "Third"]);
  });

  it("respects maxMessages limit", async () => {
    await memory.append("session-1", { role: "user", content: "A" });
    await memory.append("session-1", { role: "assistant", content: "B" });
    await memory.append("session-1", { role: "user", content: "C" });

    const history = await memory.getHistory("session-1", 2);
    expect(history).toHaveLength(2);
    // Should return the most recent 2
    expect(history[0]!.content).toBe("B");
    expect(history[1]!.content).toBe("C");
  });

  it("isolates sessions", async () => {
    await memory.append("session-1", { role: "user", content: "Session 1 msg" });
    await memory.append("session-2", { role: "user", content: "Session 2 msg" });

    const history1 = await memory.getHistory("session-1");
    const history2 = await memory.getHistory("session-2");

    expect(history1).toHaveLength(1);
    expect(history1[0]!.content).toBe("Session 1 msg");
    expect(history2).toHaveLength(1);
    expect(history2[0]!.content).toBe("Session 2 msg");
  });

  it("clears a session", async () => {
    await memory.append("session-1", { role: "user", content: "Hello" });
    await memory.append("session-1", { role: "assistant", content: "Hi" });

    await memory.clear("session-1");

    const history = await memory.getHistory("session-1");
    expect(history).toHaveLength(0);
  });

  it("preserves toolCallId and toolCalls in messages", async () => {
    await memory.append("session-1", {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc-1", name: "get_weather", arguments: { city: "London" } }],
    });
    await memory.append("session-1", {
      role: "tool",
      content: "22°C sunny",
      toolCallId: "tc-1",
    });

    const history = await memory.getHistory("session-1");
    expect(history[0]!.toolCalls).toEqual([{ id: "tc-1", name: "get_weather", arguments: { city: "London" } }]);
    expect(history[1]!.toolCallId).toBe("tc-1");
  });

  it("prunes messages beyond maxPerSession", async () => {
    const smallMemory = new PostgresConversationMemory({
      pool: mockPool.pool,
      maxPerSession: 3,
    });

    await smallMemory.append("session-1", { role: "user", content: "msg-1" });
    await smallMemory.append("session-1", { role: "assistant", content: "msg-2" });
    await smallMemory.append("session-1", { role: "user", content: "msg-3" });
    await smallMemory.append("session-1", { role: "assistant", content: "msg-4" });

    // After 4 appends with max 3, the oldest should be pruned
    const history = await smallMemory.getHistory("session-1");
    expect(history.length).toBeLessThanOrEqual(3);
  });

  it("issues correct SQL for append", async () => {
    await memory.append("session-1", { role: "user", content: "Test message" });

    const insertCall = mockPool.query.mock.calls.find(
      (call) => (call[0] as string).toLowerCase().includes("insert"),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[0]).toBe("session-1"); // session_id
    expect(params[1]).toBe("user"); // role
    expect(params[2]).toBe("Test message"); // content
  });
});
