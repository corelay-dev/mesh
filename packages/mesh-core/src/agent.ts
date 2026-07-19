import { noopTracer, type Tracer } from "@corelay/mesh-observe";
import type { Address } from "./address.js";
import type { AgentConfig } from "./agent-config.js";
import type { Inbox } from "./inbox.js";
import type { LLMClient, LLMMessage, LLMResponse } from "./llm.js";
import type { Message } from "./message.js";
import type { Peer } from "./peer.js";
import type { PeerRegistry } from "./peer-registry.js";
import type { ToolExecutor } from "./tool-executor.js";
import type { ConversationMemory } from "./memory.js";
import { ParallelToolExecutor } from "./parallel-tool-executor.js";
import type { ContextManager } from "./context-manager.js";

export class CapabilityError extends Error {
  constructor(
    public readonly agent: Address,
    public readonly target: Address,
  ) {
    super(`Agent ${agent} has no peer capability for ${target}`);
    this.name = "CapabilityError";
  }
}

/**
 * Optional hook called after the LLM responds but before the reply is
 * delivered. Return the (possibly revised) content. Throw to block delivery.
 */
export type ResponseReviewer = (params: {
  userMessage: string;
  agentResponse: string;
  systemPrompt: string;
}) => Promise<string>;

export interface AgentOptions {
  tracer?: Tracer;
  /** If set, every LLM response passes through this reviewer before send. */
  reviewer?: ResponseReviewer;
  /** Tool executor for function calling. If not set, tool_calls from LLM are ignored. */
  toolExecutor?: ToolExecutor;
  /** Conversation memory for multi-turn. If not set, each message is stateless. */
  memory?: ConversationMemory;
  /** Max tool call rounds before forcing a text response. Default 10. */
  maxToolRounds?: number;
  /** Max conversation history messages to include. Default 20. */
  maxHistoryMessages?: number;
  /**
   * Enable parallel tool execution with bounded concurrency.
   * Set to `true` for default concurrency (5), or a number for custom.
   * Default: false (sequential execution, preserving existing behaviour).
   */
  parallelToolExecution?: boolean | number;
  /**
   * Opt-in context compaction. When provided, replaces hard truncation
   * with summarisation of older turns via the injected context manager.
   */
  contextManager?: ContextManager;
}

export class Agent implements Peer {
  private readonly tracer: Tracer;
  private readonly reviewer: ResponseReviewer | undefined;
  private readonly toolExecutor: ToolExecutor | undefined;
  private readonly memory: ConversationMemory | undefined;
  private readonly maxToolRounds: number;
  private readonly maxHistoryMessages: number;
  private readonly parallelExecutor: ParallelToolExecutor | undefined;
  private readonly contextManager: ContextManager | undefined;

  constructor(
    public readonly address: Address,
    private readonly config: AgentConfig,
    private readonly llm: LLMClient,
    private readonly inbox: Inbox,
    private readonly registry: PeerRegistry,
    options: AgentOptions = {},
  ) {
    this.tracer = options.tracer ?? noopTracer;
    this.reviewer = options.reviewer;
    this.toolExecutor = options.toolExecutor;
    this.memory = options.memory;
    this.maxToolRounds = options.maxToolRounds ?? 10;
    this.maxHistoryMessages = options.maxHistoryMessages ?? 20;
    this.contextManager = options.contextManager;

    // Set up parallel tool execution if enabled
    if (options.parallelToolExecution && this.toolExecutor) {
      const concurrency = typeof options.parallelToolExecution === "number"
        ? options.parallelToolExecution
        : 5;
      this.parallelExecutor = new ParallelToolExecutor(this.toolExecutor, { concurrency });
    }
  }

  async start(): Promise<void> {
    await this.inbox.consume((m) => this.handle(m));
  }

  async send(message: Message): Promise<void> {
    await this.inbox.append(message);
  }

  private async handle(message: Message): Promise<void> {
    await this.tracer.span(
      "agent.handle",
      {
        "agent.address": this.address,
        "agent.name": this.config.name,
        "agent.model": this.config.model,
        "message.id": message.id,
        "message.from": message.from,
        "message.trace_id": message.traceId,
      },
      async (ctx) => {
        // Build messages array with conversation history
        const messages = await this.buildMessages(message);

        // Store the user message in memory
        if (this.memory) {
          await this.memory.append(message.traceId, { role: "user", content: message.content });
        }

        // LLM call with tool execution loop
        const finalContent = await this.callWithTools(messages, message.traceId);

        // Store the assistant response in memory
        if (this.memory) {
          await this.memory.append(message.traceId, { role: "assistant", content: finalContent });
        }

        // Critic / reviewer gate
        let content = finalContent;
        if (this.reviewer) {
          content = await this.tracer.span(
            "agent.review",
            { "agent.address": this.address },
            async (reviewCtx) => {
              const revised = await this.reviewer!({
                userMessage: message.content,
                agentResponse: finalContent,
                systemPrompt: this.config.prompt,
              });
              reviewCtx.setAttribute("agent.review.revised", revised !== finalContent);
              return revised;
            },
          );
        }

        const reply: Message = {
          id: `${message.id}-reply`,
          from: this.address,
          to: message.from,
          kind: "assistant",
          content,
          traceId: message.traceId,
          createdAt: Date.now(),
        };

        this.assertPeerAllowed(reply.to);
        ctx.setAttribute("reply.to", reply.to);
        await this.registry.deliver(reply);
      },
    );
  }

  private async buildMessages(message: Message): Promise<LLMMessage[]> {
    const messages: LLMMessage[] = [
      { role: "system", content: this.config.prompt },
    ];

    // Add conversation history if memory is available
    if (this.memory) {
      const history = await this.memory.getHistory(message.traceId, this.maxHistoryMessages);
      messages.push(...history);
    }

    // Add the current user message
    messages.push({ role: "user", content: message.content });

    // Apply context compaction if enabled (replaces hard truncation)
    if (this.contextManager) {
      return this.contextManager.compact(message.traceId, messages);
    }

    return messages;
  }

  /**
   * Calls the LLM in a loop, executing tool calls until the LLM produces
   * a final text response (finishReason !== "tool_calls") or max rounds exceeded.
   */
  private async callWithTools(messages: LLMMessage[], traceId: string): Promise<string> {
    let currentMessages = [...messages];
    let rounds = 0;

    while (rounds < this.maxToolRounds) {
      const response = await this.tracer.span(
        "llm.chat",
        {
          "llm.model": this.config.model,
          "llm.provider": this.llm.name,
          "llm.round": rounds,
        },
        async (llmCtx) => {
          const res = await this.llm.chat({
            messages: currentMessages,
            model: this.config.model,
            maxTokens: this.config.maxResponseTokens,
            tools: this.config.tools.length > 0 ? this.config.tools : undefined,
          });
          llmCtx.setAttributes({
            "llm.prompt_tokens": res.usage.promptTokens,
            "llm.completion_tokens": res.usage.completionTokens,
            "llm.total_tokens": res.usage.totalTokens,
            "llm.finish_reason": res.finishReason,
            "llm.tool_calls": res.toolCalls.length,
          });
          return res;
        },
      );

      // If no tool calls, return the text content
      if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0 || !this.toolExecutor) {
        return response.content;
      }

      // Execute tool calls (parallel or sequential)
      currentMessages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });

      if (this.parallelExecutor) {
        // Parallel execution — bounded concurrency, ordered results
        const results = await this.tracer.span(
          "tool.executeAll",
          { "tool.count": response.toolCalls.length },
          () => this.parallelExecutor!.executeAll(response.toolCalls),
        );
        for (const result of results) {
          currentMessages.push({
            role: "tool",
            content: result.content,
            toolCallId: result.toolCallId,
          });
        }
      } else {
        // Sequential execution (default, preserves existing behaviour)
        for (const call of response.toolCalls) {
          const result = await this.tracer.span(
            "tool.execute",
            { "tool.name": call.name, "tool.call_id": call.id },
            async (toolCtx) => {
              const r = await this.toolExecutor!.execute(call);
              toolCtx.setAttribute("tool.error", r.error ?? false);
              return r;
            },
          );

          currentMessages.push({
            role: "tool",
            content: result.content,
            toolCallId: result.toolCallId,
          });
        }
      }

      rounds++;
    }

    // Max rounds exceeded — return whatever content we have
    return `[Agent reached max tool rounds (${this.maxToolRounds})]`;
  }

  private assertPeerAllowed(target: Address): void {
    const allowed = this.config.capabilities.some(
      (c) => c.kind === "peer" && c.address === target,
    );
    if (!allowed) throw new CapabilityError(this.address, target);
  }
}
