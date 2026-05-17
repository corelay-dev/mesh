import type { LLMMessage } from "./llm.js";

/**
 * Stores conversation history per session (keyed by traceId).
 * Agents use this to maintain multi-turn context.
 */
export interface ConversationMemory {
  /** Append a message to the conversation. */
  append(sessionId: string, message: LLMMessage): Promise<void>;
  /** Get the last N messages for a session. */
  getHistory(sessionId: string, maxMessages?: number): Promise<LLMMessage[]>;
  /** Clear a session's history. */
  clear(sessionId: string): Promise<void>;
}

/**
 * In-memory conversation buffer. Suitable for single-instance deployments.
 * For multi-pod, use a Postgres-backed implementation.
 */
export class MemoryConversationBuffer implements ConversationMemory {
  private readonly sessions = new Map<string, { messages: LLMMessage[]; lastAccess: number }>();
  private readonly maxPerSession: number;
  private readonly maxSessions: number;
  private accessCounter = 0;

  constructor(maxPerSession = 50, maxSessions = 1000) {
    this.maxPerSession = maxPerSession;
    this.maxSessions = maxSessions;
  }

  async append(sessionId: string, message: LLMMessage): Promise<void> {
    const session = this.sessions.get(sessionId) ?? { messages: [], lastAccess: 0 };
    session.messages.push(message);
    session.lastAccess = ++this.accessCounter;
    if (session.messages.length > this.maxPerSession) {
      session.messages.splice(0, session.messages.length - this.maxPerSession);
    }
    this.sessions.set(sessionId, session);
    this.evictIfNeeded();
  }

  async getHistory(sessionId: string, maxMessages?: number): Promise<LLMMessage[]> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    session.lastAccess = ++this.accessCounter;
    const messages = session.messages;
    if (maxMessages && messages.length > maxMessages) {
      return messages.slice(-maxMessages);
    }
    return [...messages];
  }

  async clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  private evictIfNeeded(): void {
    if (this.sessions.size <= this.maxSessions) return;
    // Evict least recently accessed sessions
    const entries = [...this.sessions.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toEvict = entries.slice(0, this.sessions.size - this.maxSessions);
    for (const [key] of toEvict) {
      this.sessions.delete(key);
    }
  }
}
