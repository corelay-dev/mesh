import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { OpenAIClient } from "../src/openai.js";
import type { LLMRequestExt, LLMResponseExt, StreamDelta } from "../src/types.js";
import { BudgetExceededError } from "../src/types.js";

const makeMockClient = (completion: Partial<OpenAI.Chat.Completions.ChatCompletion>): { sdk: OpenAI; create: ReturnType<typeof vi.fn> } => {
  const create = vi.fn().mockResolvedValue({
    id: "c",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o",
    choices: [],
    ...completion,
  });
  return {
    sdk: { chat: { completions: { create } } } as unknown as OpenAI,
    create,
  };
};

describe("OpenAIClient — prompt caching", () => {
  it("preserves system-first message ordering for stable prefix", async () => {
    const { sdk, create } = makeMockClient({
      choices: [{ index: 0, message: { role: "assistant", content: "ok", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const client = new OpenAIClient({ client: sdk });
    const request: LLMRequestExt = {
      model: "gpt-4o",
      enablePromptCaching: true,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
      tools: [{ name: "search", description: "Search the web", parameters: { type: "object" } }],
    };
    await client.chat(request);

    const call = create.mock.calls[0]?.[0];
    // System message comes first (stable prefix)
    expect(call.messages[0].role).toBe("system");
    // Tools are present
    expect(call.tools).toHaveLength(1);
  });

  it("reports cachedTokens in usage when present in response", async () => {
    const { sdk } = makeMockClient({
      choices: [{ index: 0, message: { role: "assistant", content: "hi", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 80 },
      } as unknown as OpenAI.CompletionUsage,
    });

    const client = new OpenAIClient({ client: sdk });
    const res = await client.chat({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], enablePromptCaching: true }) as LLMResponseExt;

    expect(res.usage.cachedTokens).toBe(80);
  });
});

describe("OpenAIClient — cost tracking", () => {
  it("computes costUsd when model is in pricing table", async () => {
    const { sdk } = makeMockClient({
      choices: [{ index: 0, message: { role: "assistant", content: "hi", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    });

    const client = new OpenAIClient({ client: sdk });
    const res = await client.chat({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }) as LLMResponseExt;

    expect(res.costUsd).toBeCloseTo(0.0075, 6);
  });

  it("costUsd is undefined for unknown models", async () => {
    const { sdk } = makeMockClient({
      model: "gpt-custom-fine-tuned",
      choices: [{ index: 0, message: { role: "assistant", content: "hi", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const client = new OpenAIClient({ client: sdk });
    const res = await client.chat({ model: "gpt-custom-fine-tuned", messages: [{ role: "user", content: "hi" }] }) as LLMResponseExt;

    expect(res.costUsd).toBeUndefined();
  });

  it("throws BudgetExceededError when budget is exhausted", async () => {
    const { sdk } = makeMockClient({
      choices: [{ index: 0, message: { role: "assistant", content: "hi", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });

    // gpt-4o: input $2.5/M + output $10/M = $12.5 per call with these counts
    const client = new OpenAIClient({ client: sdk, budget: { maxCostUsd: 5.0 } });

    await expect(
      client.chat({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(BudgetExceededError);
  });
});

describe("OpenAIClient — reasoning/extended thinking", () => {
  it("sends reasoning_effort param when thinking is configured", async () => {
    const { sdk, create } = makeMockClient({
      choices: [{ index: 0, message: { role: "assistant", content: "done", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const client = new OpenAIClient({ client: sdk });
    const request: LLMRequestExt = {
      model: "o3",
      messages: [{ role: "user", content: "think hard" }],
      thinking: { budgetTokens: 8192 },
    };
    await client.chat(request);

    const call = create.mock.calls[0]?.[0];
    expect(call.reasoning_effort).toBe("high");
  });

  it("derives effort from budgetTokens: low for <=1024", async () => {
    const { sdk, create } = makeMockClient({
      choices: [{ index: 0, message: { role: "assistant", content: "ok", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const client = new OpenAIClient({ client: sdk });
    await client.chat({
      model: "o3",
      messages: [{ role: "user", content: "quick" }],
      thinking: { budgetTokens: 512 },
    });

    expect(create.mock.calls[0]?.[0].reasoning_effort).toBe("low");
  });

  it("uses explicit effort when provided", async () => {
    const { sdk, create } = makeMockClient({
      choices: [{ index: 0, message: { role: "assistant", content: "ok", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const client = new OpenAIClient({ client: sdk });
    await client.chat({
      model: "o3",
      messages: [{ role: "user", content: "think" }],
      thinking: { budgetTokens: 100, effort: "medium" },
    });

    expect(create.mock.calls[0]?.[0].reasoning_effort).toBe("medium");
  });

  it("reports thinkingTokens in usage when present", async () => {
    const { sdk } = makeMockClient({
      choices: [{ index: 0, message: { role: "assistant", content: "ok", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
        completion_tokens_details: { reasoning_tokens: 150 },
      } as unknown as OpenAI.CompletionUsage,
    });

    const client = new OpenAIClient({ client: sdk });
    const res = await client.chat({
      model: "o3",
      messages: [{ role: "user", content: "reason" }],
      thinking: { budgetTokens: 4096 },
    }) as LLMResponseExt;

    expect(res.usage.thinkingTokens).toBe(150);
  });
});

describe("OpenAIClient — streaming", () => {
  it("yields text deltas and a final done event", async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];

    const asyncIter = (async function* () {
      for (const c of chunks) yield c;
    })();

    const create = vi.fn().mockResolvedValue(asyncIter);
    const sdk = { chat: { completions: { create } } } as unknown as OpenAI;

    const client = new OpenAIClient({ client: sdk });
    const deltas: StreamDelta[] = [];
    for await (const d of client.chatStream({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    })) {
      deltas.push(d);
    }

    const textDeltas = deltas.filter((d) => d.type === "text");
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as { type: "text"; content: string }).content).toBe("Hello");
    expect((textDeltas[1] as { type: "text"; content: string }).content).toBe(" world");

    const done = deltas.find((d) => d.type === "done");
    expect(done).toBeDefined();
    expect((done as { type: "done"; response: LLMResponseExt }).response.content).toBe("Hello world");
  });

  it("yields tool_call deltas during streaming", async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '":"hi"}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];

    const asyncIter = (async function* () {
      for (const c of chunks) yield c;
    })();

    const create = vi.fn().mockResolvedValue(asyncIter);
    const sdk = { chat: { completions: { create } } } as unknown as OpenAI;

    const client = new OpenAIClient({ client: sdk });
    const deltas: StreamDelta[] = [];
    for await (const d of client.chatStream({
      model: "gpt-4o",
      messages: [{ role: "user", content: "search" }],
      tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
    })) {
      deltas.push(d);
    }

    const toolDeltas = deltas.filter((d) => d.type === "tool_call");
    expect(toolDeltas.length).toBeGreaterThan(0);

    const done = deltas.find((d) => d.type === "done") as { type: "done"; response: LLMResponseExt };
    expect(done.response.toolCalls).toHaveLength(1);
    expect(done.response.toolCalls[0]?.name).toBe("search");
    expect(done.response.toolCalls[0]?.arguments).toEqual({ q: "hi" });
  });

  it("passes stream=true and stream_options to the SDK", async () => {
    const asyncIter = (async function* () {
      yield { choices: [{ index: 0, delta: { content: "x" }, finish_reason: "stop" }] };
    })();

    const create = vi.fn().mockResolvedValue(asyncIter);
    const sdk = { chat: { completions: { create } } } as unknown as OpenAI;

    const client = new OpenAIClient({ client: sdk });
    const deltas: StreamDelta[] = [];
    for await (const d of client.chatStream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] })) {
      deltas.push(d);
    }

    const call = create.mock.calls[0]?.[0];
    expect(call.stream).toBe(true);
    expect(call.stream_options).toEqual({ include_usage: true });
  });
});
