import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { OpenAIClient } from "../src/openai.js";

const makeMockClient = (completion: Partial<OpenAI.Chat.Completions.ChatCompletion>): OpenAI => {
  const create = vi.fn().mockResolvedValue({
    id: "c",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mini",
    choices: [],
    ...completion,
  });
  return {
    chat: { completions: { create } },
  } as unknown as OpenAI;
};

describe("OpenAIClient", () => {
  it("returns the assistant message and usage", async () => {
    const mock = makeMockClient({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello there!", refusal: null },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const client = new OpenAIClient({ client: mock });
    const res = await client.chat({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o-mini",
    });

    expect(res.content).toBe("Hello there!");
    expect(res.model).toBe("gpt-4o-mini");
    expect(res.toolCalls).toEqual([]);
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  });

  it("parses tool calls", async () => {
    const mock = makeMockClient({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "search", arguments: '{"query":"tax"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
    });

    const client = new OpenAIClient({ client: mock });
    const res = await client.chat({
      messages: [{ role: "user", content: "find things" }],
      model: "gpt-4o-mini",
    });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toEqual({
      id: "call_1",
      name: "search",
      arguments: { query: "tax" },
    });
    expect(res.finishReason).toBe("tool_calls");
  });

  it("defaults bad tool-call JSON to empty args", async () => {
    const mock = makeMockClient({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "search", arguments: "not json" },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
    });

    const client = new OpenAIClient({ client: mock });
    const res = await client.chat({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o-mini",
    });

    expect(res.toolCalls[0]?.arguments).toEqual({});
  });

  it("uses a custom name when provided", async () => {
    const client = new OpenAIClient({ client: makeMockClient({}), name: "openai-prod" });
    expect(client.name).toBe("openai-prod");
  });

  it("defaults name to 'openai'", async () => {
    const client = new OpenAIClient({ client: makeMockClient({}) });
    expect(client.name).toBe("openai");
  });
});
