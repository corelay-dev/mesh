import { describe, it, expect, vi } from "vitest";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockClient } from "../src/bedrock.js";
import type { LLMRequestExt, LLMResponseExt, StreamDelta } from "../src/types.js";
import { BudgetExceededError } from "../src/types.js";

const mockSendWith = (payload: Record<string, unknown>) => {
  const send = vi.fn().mockResolvedValue({
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });
  const client = Object.create(BedrockRuntimeClient.prototype) as BedrockRuntimeClient;
  (client as unknown as { send: typeof send }).send = send;
  return { client, send };
};

describe("BedrockClient — prompt caching", () => {
  it("adds cache_control to system and last tool when enabled", async () => {
    const { client, send } = mockSendWith({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const c = new BedrockClient({ client });
    const request: LLMRequestExt = {
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
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

    const body = JSON.parse(new TextDecoder().decode(send.mock.calls[0]?.[0].input.body));
    expect(body.system).toEqual([
      { type: "text", text: "You are helpful.", cache_control: { type: "ephemeral" } },
    ]);
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("uses plain string system when caching disabled", async () => {
    const { client, send } = mockSendWith({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const c = new BedrockClient({ client });
    await c.chat({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [
        { role: "system", content: "Be kind." },
        { role: "user", content: "hi" },
      ],
      maxTokens: 100,
    });

    const body = JSON.parse(new TextDecoder().decode(send.mock.calls[0]?.[0].input.body));
    expect(body.system).toBe("Be kind.");
  });

  it("reports cachedTokens from cache_read_input_tokens", async () => {
    const { client } = mockSendWith({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 },
    });

    const c = new BedrockClient({ client });
    const res = await c.chat({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [{ role: "user", content: "hi" }],
      enablePromptCaching: true,
      maxTokens: 100,
    }) as LLMResponseExt;

    expect(res.usage.cachedTokens).toBe(80);
  });
});

describe("BedrockClient — cost tracking", () => {
  it("includes costUsd for known Bedrock models", async () => {
    const { client } = mockSendWith({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 500 },
    });

    const c = new BedrockClient({ client });
    const res = await c.chat({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    }) as LLMResponseExt;

    // input: 1000/1M * 3 = 0.003, output: 500/1M * 15 = 0.0075
    expect(res.costUsd).toBeCloseTo(0.0105, 6);
  });

  it("throws BudgetExceededError when budget exhausted", async () => {
    const { client } = mockSendWith({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    });

    const c = new BedrockClient({ client, budget: { maxCostUsd: 5.0 } });
    await expect(
      c.chat({
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      }),
    ).rejects.toThrow(BudgetExceededError);
  });
});

describe("BedrockClient — extended thinking", () => {
  it("sends thinking config in the body", async () => {
    const { client, send } = mockSendWith({
      content: [{ type: "text", text: "deep thought" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 50 },
    });

    const c = new BedrockClient({ client });
    await c.chat({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [{ role: "user", content: "think" }],
      thinking: { budgetTokens: 8192 },
      maxTokens: 1024,
    });

    const body = JSON.parse(new TextDecoder().decode(send.mock.calls[0]?.[0].input.body));
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(body.temperature).toBe(1);
  });

  it("reports thinkingTokens from response", async () => {
    const { client } = mockSendWith({
      content: [
        { type: "thinking", thinking: "Hmm..." },
        { type: "text", text: "42" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 100, thinking_tokens: 80 },
    });

    const c = new BedrockClient({ client });
    const res = await c.chat({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [{ role: "user", content: "think" }],
      thinking: { budgetTokens: 4096 },
      maxTokens: 1024,
    }) as LLMResponseExt;

    expect(res.usage.thinkingTokens).toBe(80);
    expect(res.content).toBe("42");
  });
});

describe("BedrockClient — streaming", () => {
  it("yields text deltas from InvokeModelWithResponseStream", async () => {
    const streamEvents = [
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "message_delta", usage: { output_tokens: 5 } },
    ];

    const asyncIter = (async function* () {
      for (const e of streamEvents) {
        yield { chunk: { bytes: new TextEncoder().encode(JSON.stringify(e)) } };
      }
    })();

    const send = vi.fn().mockImplementation((command) => {
      if (command.constructor.name === "InvokeModelWithResponseStreamCommand") {
        return Promise.resolve({ body: asyncIter });
      }
      return Promise.resolve({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      });
    });

    const client = Object.create(BedrockRuntimeClient.prototype) as BedrockRuntimeClient;
    (client as unknown as { send: typeof send }).send = send;

    const c = new BedrockClient({ client });
    const deltas: StreamDelta[] = [];
    for await (const d of c.chatStream({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    })) {
      deltas.push(d);
    }

    const textDeltas = deltas.filter((d) => d.type === "text");
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as { type: "text"; content: string }).content).toBe("Hello");

    const done = deltas.find((d) => d.type === "done") as { type: "done"; response: LLMResponseExt };
    expect(done.response.content).toBe("Hello world");
    expect(done.response.usage.promptTokens).toBe(10);
    expect(done.response.usage.completionTokens).toBe(5);
  });

  it("yields tool_call deltas from streaming", async () => {
    const streamEvents = [
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "search" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"test"}' } },
      { type: "message_delta", usage: { output_tokens: 8 } },
    ];

    const asyncIter = (async function* () {
      for (const e of streamEvents) {
        yield { chunk: { bytes: new TextEncoder().encode(JSON.stringify(e)) } };
      }
    })();

    const send = vi.fn().mockImplementation((command) => {
      if (command.constructor.name === "InvokeModelWithResponseStreamCommand") {
        return Promise.resolve({ body: asyncIter });
      }
      return Promise.resolve({ body: new TextEncoder().encode("{}") });
    });

    const client = Object.create(BedrockRuntimeClient.prototype) as BedrockRuntimeClient;
    (client as unknown as { send: typeof send }).send = send;

    const c = new BedrockClient({ client });
    const deltas: StreamDelta[] = [];
    for await (const d of c.chatStream({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [{ role: "user", content: "find" }],
      tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
      maxTokens: 100,
    })) {
      deltas.push(d);
    }

    const done = deltas.find((d) => d.type === "done") as { type: "done"; response: LLMResponseExt };
    expect(done.response.toolCalls).toHaveLength(1);
    expect(done.response.toolCalls[0]?.name).toBe("search");
    expect(done.response.toolCalls[0]?.arguments).toEqual({ q: "test" });
  });

  it("rejects non-anthropic models for streaming", async () => {
    const { client } = mockSendWith({});
    const c = new BedrockClient({ client });

    const iter = c.chatStream({
      model: "amazon.nova-pro-v1:0",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    });

    await expect(async () => {
      for await (const _ of iter) { /* consume */ }
    }).rejects.toThrow(/only anthropic/i);
  });
});
