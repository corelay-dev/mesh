import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicClient } from "../src/anthropic.js";
import type { LLMRequestExt, LLMResponseExt, StreamDelta } from "../src/types.js";
import { BudgetExceededError } from "../src/types.js";

const makeMockClient = (
  response: Partial<Anthropic.Message>,
): { client: Anthropic; create: ReturnType<typeof vi.fn> } => {
  const create = vi.fn().mockResolvedValue({
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-3-5-sonnet-latest",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    ...response,
  });
  return {
    client: { messages: { create } } as unknown as Anthropic,
    create,
  };
};

describe("AnthropicClient — prompt caching", () => {
  it("adds cache_control breakpoints to system and last tool when enabled", async () => {
    const { client, create } = makeMockClient({
      content: [{ type: "text", text: "ok", citations: null }],
      usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
    });

    const c = new AnthropicClient({ client });
    const request: LLMRequestExt = {
      model: "claude-3-5-sonnet-latest",
      enablePromptCaching: true,
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
      tools: [
        { name: "tool_a", description: "A", parameters: { type: "object" } },
        { name: "tool_b", description: "B", parameters: { type: "object" } },
      ],
      maxTokens: 100,
    };
    await c.chat(request);

    const call = create.mock.calls[0]?.[0];
    // System should be structured with cache_control on last block
    expect(call.system).toEqual([
      { type: "text", text: "You are helpful.", cache_control: { type: "ephemeral" } },
    ]);
    // Last tool should have cache_control
    expect(call.tools[0].cache_control).toBeUndefined();
    expect(call.tools[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("uses plain string system when caching is disabled", async () => {
    const { client, create } = makeMockClient({
      content: [{ type: "text", text: "ok", citations: null }],
      usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
    });

    const c = new AnthropicClient({ client });
    await c.chat({
      model: "claude-3-5-sonnet-latest",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hi" },
      ],
      maxTokens: 100,
    });

    expect(create.mock.calls[0]?.[0].system).toBe("Be terse.");
  });

  it("reports cachedTokens from cache_read_input_tokens", async () => {
    const { client } = makeMockClient({
      content: [{ type: "text", text: "ok", citations: null }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 } as unknown as Anthropic.Usage,
    });

    const c = new AnthropicClient({ client });
    const res = await c.chat({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "hi" }],
      enablePromptCaching: true,
      maxTokens: 100,
    }) as LLMResponseExt;

    expect(res.usage.cachedTokens).toBe(80);
  });
});

describe("AnthropicClient — cost tracking", () => {
  it("includes costUsd in response for known models", async () => {
    const { client } = makeMockClient({
      content: [{ type: "text", text: "ok", citations: null }],
      usage: { input_tokens: 1000, output_tokens: 500 } as Anthropic.Usage,
    });

    const c = new AnthropicClient({ client });
    const res = await c.chat({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    }) as LLMResponseExt;

    // input: 1000/1M * 3 = 0.003, output: 500/1M * 15 = 0.0075
    expect(res.costUsd).toBeCloseTo(0.0105, 6);
  });

  it("enforces budget cap", async () => {
    const { client } = makeMockClient({
      content: [{ type: "text", text: "ok", citations: null }],
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } as Anthropic.Usage,
    });

    // claude-3-5-sonnet: $3 input + $15 output = $18 per request
    const c = new AnthropicClient({ client, budget: { maxCostUsd: 5.0 } });

    await expect(
      c.chat({
        model: "claude-3-5-sonnet-latest",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      }),
    ).rejects.toThrow(BudgetExceededError);
  });
});

describe("AnthropicClient — extended thinking", () => {
  it("sends thinking config to the API", async () => {
    const { client, create } = makeMockClient({
      content: [{ type: "text", text: "thought deeply", citations: null }],
      usage: { input_tokens: 10, output_tokens: 100 } as Anthropic.Usage,
    });

    const c = new AnthropicClient({ client });
    await c.chat({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "think" }],
      thinking: { budgetTokens: 4096 },
      maxTokens: 1024,
    });

    const call = create.mock.calls[0]?.[0];
    expect(call.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    // Temperature must be 1 for extended thinking
    expect(call.temperature).toBe(1);
  });

  it("reports thinkingTokens when response contains thinking blocks", async () => {
    const { client } = makeMockClient({
      content: [
        { type: "thinking", thinking: "Let me consider..." } as unknown as Anthropic.TextBlock,
        { type: "text", text: "The answer is 42", citations: null },
      ],
      usage: { input_tokens: 50, output_tokens: 200, thinking_tokens: 150 } as unknown as Anthropic.Usage,
    });

    const c = new AnthropicClient({ client });
    const res = await c.chat({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "think" }],
      thinking: { budgetTokens: 4096 },
      maxTokens: 1024,
    }) as LLMResponseExt;

    expect(res.usage.thinkingTokens).toBe(150);
    expect(res.content).toBe("The answer is 42");
  });
});

describe("AnthropicClient — streaming", () => {
  it("yields text and done events from a stream", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "message_delta", usage: { output_tokens: 5 } },
    ];

    const asyncIter = (async function* () {
      for (const e of events) yield e;
    })();

    const create = vi.fn().mockResolvedValue(asyncIter);
    const client = { messages: { create } } as unknown as Anthropic;

    const c = new AnthropicClient({ client });
    const deltas: StreamDelta[] = [];
    for await (const d of c.chatStream({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    })) {
      deltas.push(d);
    }

    const textDeltas = deltas.filter((d) => d.type === "text");
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as { type: "text"; content: string }).content).toBe("Hello");

    const done = deltas.find((d) => d.type === "done") as { type: "done"; response: LLMResponseExt };
    expect(done).toBeDefined();
    expect(done.response.content).toBe("Hello world");
    expect(done.response.usage.promptTokens).toBe(10);
    expect(done.response.usage.completionTokens).toBe(5);
  });

  it("yields thinking deltas during streaming", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 5 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think..." } },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "42" } },
      { type: "message_delta", usage: { output_tokens: 20 } },
    ];

    const asyncIter = (async function* () {
      for (const e of events) yield e;
    })();

    const create = vi.fn().mockResolvedValue(asyncIter);
    const client = { messages: { create } } as unknown as Anthropic;

    const c = new AnthropicClient({ client });
    const deltas: StreamDelta[] = [];
    for await (const d of c.chatStream({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "think" }],
      thinking: { budgetTokens: 4096 },
      maxTokens: 1024,
    })) {
      deltas.push(d);
    }

    const thinkingDeltas = deltas.filter((d) => d.type === "thinking");
    expect(thinkingDeltas).toHaveLength(1);
    expect((thinkingDeltas[0] as { type: "thinking"; content: string }).content).toBe("Let me think...");
  });

  it("yields tool_call deltas during streaming", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "search" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"he' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'llo"}' } },
      { type: "message_delta", usage: { output_tokens: 8 } },
    ];

    const asyncIter = (async function* () {
      for (const e of events) yield e;
    })();

    const create = vi.fn().mockResolvedValue(asyncIter);
    const client = { messages: { create } } as unknown as Anthropic;

    const c = new AnthropicClient({ client });
    const deltas: StreamDelta[] = [];
    for await (const d of c.chatStream({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "search" }],
      tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
      maxTokens: 100,
    })) {
      deltas.push(d);
    }

    const toolDeltas = deltas.filter((d) => d.type === "tool_call");
    expect(toolDeltas.length).toBeGreaterThan(0);

    const done = deltas.find((d) => d.type === "done") as { type: "done"; response: LLMResponseExt };
    expect(done.response.toolCalls).toHaveLength(1);
    expect(done.response.toolCalls[0]?.name).toBe("search");
    expect(done.response.toolCalls[0]?.arguments).toEqual({ q: "hello" });
  });
});
