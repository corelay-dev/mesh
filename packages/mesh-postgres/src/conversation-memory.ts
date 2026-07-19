import type { Pool } from "pg";
import type { ConversationMemory, LLMMessage } from "@corelay/mesh-core";

export interface PostgresConversationMemoryConfig {
  pool: Pool;
  /** Table name for conversation messages. Default "conversation_messages". */
  table?: string;
  /** Max messages to keep per session (older messages are pruned). Default 200. */
  maxPerSession?: number;
}

/**
 * Durable conversation memory backed by Postgres.
 *
 * Enables cross-session, multi-pod conversation continuity. Each message is
 * stored as a row with a session ID, sequence number, role, and content.
 *
 * Requires the conversation_messages table (see sql/002-conversation-memory.sql).
 */
export class PostgresConversationMemory implements ConversationMemory {
  private readonly pool: Pool;
  private readonly table: string;
  private readonly maxPerSession: number;

  constructor(config: PostgresConversationMemoryConfig) {
    this.pool = config.pool;
    this.table = config.table ?? "conversation_messages";
    this.maxPerSession = config.maxPerSession ?? 200;
  }

  async append(sessionId: string, message: LLMMessage): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table} (session_id, role, content, tool_call_id, tool_calls, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        message.role,
        message.content,
        message.toolCallId ?? null,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        Date.now(),
      ],
    );

    // Prune old messages beyond maxPerSession
    await this.pool.query(
      `DELETE FROM ${this.table}
       WHERE session_id = $1
         AND seq NOT IN (
           SELECT seq FROM ${this.table}
           WHERE session_id = $1
           ORDER BY seq DESC
           LIMIT $2
         )`,
      [sessionId, this.maxPerSession],
    );
  }

  async getHistory(sessionId: string, maxMessages?: number): Promise<LLMMessage[]> {
    const limit = maxMessages ?? this.maxPerSession;

    const { rows } = await this.pool.query<{
      role: LLMMessage["role"];
      content: string;
      tool_call_id: string | null;
      tool_calls: string | null;
    }>(
      `SELECT role, content, tool_call_id, tool_calls
       FROM ${this.table}
       WHERE session_id = $1
       ORDER BY seq DESC
       LIMIT $2`,
      [sessionId, limit],
    );

    // Reverse to chronological order
    rows.reverse();

    return rows.map((row) => {
      const msg: LLMMessage = { role: row.role, content: row.content };
      if (row.tool_call_id) msg.toolCallId = row.tool_call_id;
      if (row.tool_calls) {
        msg.toolCalls = typeof row.tool_calls === "string"
          ? JSON.parse(row.tool_calls)
          : row.tool_calls;
      }
      return msg;
    });
  }

  async clear(sessionId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE session_id = $1`,
      [sessionId],
    );
  }
}
