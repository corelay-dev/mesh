import type { LLMMessage } from "./llm.js";

/**
 * Summariser function — takes a set of messages and produces a concise summary.
 * Typically backed by an LLM call.
 */
export type ContextSummariser = (messages: LLMMessage[]) => Promise<string>;

/**
 * Emitted when context compaction occurs.
 */
export interface CompactionEvent {
  sessionId: string;
  /** Number of messages before compaction. */
  originalCount: number;
  /** Number of messages after compaction. */
  compactedCount: number;
  /** Number of tool results cleared (content replaced with placeholder). */
  toolResultsCleared: number;
  /** The summary that replaced older turns. */
  summary: string;
  timestamp: number;
}

export type CompactionListener = (event: CompactionEvent) => void;

export interface ContextManagerOptions {
  /** Maximum token budget for context (approximate, based on message count heuristic). */
  maxTokenBudget?: number;
  /** Average tokens per message — used for budget estimation. Default 150. */
  avgTokensPerMessage?: number;
  /** Number of recent messages to always preserve (never summarise). Default 6. */
  preserveRecentCount?: number;
  /** If true, clear content of old tool-result messages (keep the record they happened). Default true. */
  clearOldToolResults?: boolean;
  /** Age threshold (in message count from end) after which tool results are cleared. Default 10. */
  toolResultClearThreshold?: number;
}

/**
 * Token-budget-aware context manager. Replaces hard truncation with
 * summarisation of older turns and clearing of stale tool results.
 *
 * Opt-in: only active when a `ContextSummariser` is provided.
 */
export class ContextManager {
  private readonly summariser: ContextSummariser;
  private readonly maxTokenBudget: number;
  private readonly avgTokensPerMessage: number;
  private readonly preserveRecentCount: number;
  private readonly clearOldToolResults: boolean;
  private readonly toolResultClearThreshold: number;
  private readonly listeners: Set<CompactionListener> = new Set();

  constructor(summariser: ContextSummariser, options: ContextManagerOptions = {}) {
    this.summariser = summariser;
    this.maxTokenBudget = options.maxTokenBudget ?? 8000;
    this.avgTokensPerMessage = options.avgTokensPerMessage ?? 150;
    this.preserveRecentCount = options.preserveRecentCount ?? 6;
    this.clearOldToolResults = options.clearOldToolResults ?? true;
    this.toolResultClearThreshold = options.toolResultClearThreshold ?? 10;
  }

  onCompaction(listener: CompactionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Compact a message history to fit within the token budget.
   * Returns the compacted messages (system message preserved at front).
   */
  async compact(sessionId: string, messages: LLMMessage[]): Promise<LLMMessage[]> {
    const estimatedTokens = messages.length * this.avgTokensPerMessage;

    if (estimatedTokens <= this.maxTokenBudget) {
      // Within budget — only clear old tool results if enabled
      if (this.clearOldToolResults) {
        return this.clearToolResults(messages);
      }
      return messages;
    }

    // Separate system message from the rest
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // Always preserve recent messages
    const preserveCount = Math.min(this.preserveRecentCount, conversationMessages.length);
    const recentMessages = conversationMessages.slice(-preserveCount);
    const olderMessages = conversationMessages.slice(0, -preserveCount);

    if (olderMessages.length === 0) {
      return messages;
    }

    // Summarise older messages
    const summary = await this.summariser(olderMessages);

    const summaryMessage: LLMMessage = {
      role: "system",
      content: `[Conversation summary of ${olderMessages.length} earlier messages]: ${summary}`,
    };

    let toolResultsCleared = 0;
    let compactedRecent = recentMessages;
    if (this.clearOldToolResults) {
      const result = this.clearToolResultsWithCount(recentMessages);
      compactedRecent = result.messages;
      toolResultsCleared = result.cleared;
    }

    const compacted = [...systemMessages, summaryMessage, ...compactedRecent];

    const event: CompactionEvent = {
      sessionId,
      originalCount: messages.length,
      compactedCount: compacted.length,
      toolResultsCleared,
      summary,
      timestamp: Date.now(),
    };

    for (const listener of this.listeners) {
      listener(event);
    }

    return compacted;
  }

  private clearToolResults(messages: LLMMessage[]): LLMMessage[] {
    return this.clearToolResultsWithCount(messages).messages;
  }

  private clearToolResultsWithCount(messages: LLMMessage[]): { messages: LLMMessage[]; cleared: number } {
    const threshold = messages.length - this.toolResultClearThreshold;
    let cleared = 0;

    const result = messages.map((msg, i) => {
      if (i < threshold && msg.role === "tool" && msg.content.length > 0) {
        cleared++;
        return { ...msg, content: "[tool result cleared — re-fetchable]" };
      }
      return msg;
    });

    return { messages: result, cleared };
  }
}
