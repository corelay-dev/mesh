import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicClient } from "../src/anthropic.js";
import type { LLMRequestExt } from "../src/types.js";

const makeMockClient = (response: Partial<Anthropic.Message>): Anthropic => {
  const create = vi.fn().mockResolvedValue({
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-20250514",
    content: [{ type: "text", text: "hello" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
    ...response,
  });
  return {
    messages: { create },
  } as unknown as Anthropic;
};

describe("AnthropicClient — structured outputs", () => {
  it("passes input_schema from tool parameters to Anthropic", async () => {
    const mock = makeMockClient({});
    const client = new AnthropicClient({ client: mock });

    const request: LLMRequestExt = {
      messages: [{ role: "user", content: "search for cats" }],
      model: "claude-sonnet-4-20250514",
      tools: [
        {
          name: "search",
          description: "Search items",
          parameters: {
            type: "object",
            properties: { query: { type: "string" }, limit: { type: "integer" } },
            required: ["query"],
          },
        },
      ],
    };

    await client.chat(request);

    const createFn = (mock.messages.create as ReturnType<typeof vi.fn>);
    const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;
    const tools = passedParams.tools as Array<{ name: string; input_schema: Record<string, unknown> }>;

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("search");
    expect(tools[0]!.input_schema).toEqual({
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer" } },
      required: ["query"],
    });
  });

  it("ignores responseSchema (Anthropic does not support structured response format)", async () => {
    const mock = makeMockClient({});
    const client = new AnthropicClient({ client: mock });

    const request: LLMRequestExt = {
      messages: [{ role: "user", content: "test" }],
      model: "claude-sonnet-4-20250514",
      responseSchema: {
        name: "output",
        schema: { type: "object", properties: { answer: { type: "string" } } },
      },
    };

    await client.chat(request);

    const createFn = (mock.messages.create as ReturnType<typeof vi.fn>);
    const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;

    // Anthropic should not have response_format since it doesn't support it
    expect(passedParams.response_format).toBeUndefined();
  });

  it("strictToolSchemas has no effect on Anthropic (always sends input_schema)", async () => {
    const mock = makeMockClient({});
    const client = new AnthropicClient({ client: mock });

    const request: LLMRequestExt = {
      messages: [{ role: "user", content: "test" }],
      model: "claude-sonnet-4-20250514",
      tools: [
        {
          name: "tool_a",
          description: "A tool",
          parameters: { type: "object", properties: { x: { type: "number" } } },
        },
      ],
      strictToolSchemas: true,
    };

    await client.chat(request);

    const createFn = (mock.messages.create as ReturnType<typeof vi.fn>);
    const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;
    const tools = passedParams.tools as Array<Record<string, unknown>>;

    // Anthropic doesn't have a strict flag — just input_schema
    expect(tools[0]!.input_schema).toEqual({
      type: "object",
      properties: { x: { type: "number" } },
    });
    expect(tools[0]!.strict).toBeUndefined();
  });
});
