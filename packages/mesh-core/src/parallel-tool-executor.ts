import type { ToolCall, ToolResult } from "./tool.js";
import type { ToolExecutor } from "./tool-executor.js";

export interface ParallelToolExecutorOptions {
  /** Maximum number of tool calls to execute concurrently. Default 5. */
  concurrency?: number;
}

/**
 * Wraps a ToolExecutor to execute multiple tool calls in parallel with
 * bounded concurrency. Results are returned in the same order as the input
 * calls (paired by toolCallId), regardless of completion order.
 */
export class ParallelToolExecutor implements ToolExecutor {
  private readonly inner: ToolExecutor;
  private readonly concurrency: number;

  constructor(inner: ToolExecutor, options: ParallelToolExecutorOptions = {}) {
    this.inner = inner;
    this.concurrency = options.concurrency ?? 5;
  }

  /** Execute a single call — delegates to inner executor. */
  async execute(call: ToolCall): Promise<ToolResult> {
    return this.inner.execute(call);
  }

  /**
   * Execute multiple tool calls concurrently with bounded concurrency.
   * Returns results in the same positional order as the input calls.
   */
  async executeAll(calls: ReadonlyArray<ToolCall>): Promise<ToolResult[]> {
    if (calls.length === 0) return [];
    if (calls.length === 1) return [await this.inner.execute(calls[0]!)];

    const results: ToolResult[] = new Array(calls.length);
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
      while (nextIndex < calls.length) {
        const idx = nextIndex++;
        const call = calls[idx]!;
        results[idx] = await this.inner.execute(call);
      }
    };

    const workers = Array.from(
      { length: Math.min(this.concurrency, calls.length) },
      () => runNext(),
    );

    await Promise.all(workers);
    return results;
  }
}
