import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { OpenAIClient } from "../src/openai.js";
import type { LLMRequestExt } from "../src/types.js";

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

describe("OpenAIClient — structured outputs", () => {
  describe("strict tool schemas", () => {
    it("sends strict: true on tool functions when strictToolSchemas is enabled", async () => {
      const mock = makeMockClient({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok", refusal: null },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const client = new OpenAIClient({ client: mock });
      const request: LLMRequestExt = {
        messages: [{ role: "user", content: "search for cats" }],
        model: "gpt-4o-mini",
        tools: [
          {
            name: "search",
            description: "Search items",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        ],
        strictToolSchemas: true,
      };

      await client.chat(request);

      const createFn = (mock.chat.completions.create as ReturnType<typeof vi.fn>);
      const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;
      const tools = passedParams.tools as Array<{ type: string; function: Record<string, unknown> }>;

      expect(tools).toHaveLength(1);
      expect(tools[0]!.function.strict).toBe(true);
      expect(tools[0]!.function.name).toBe("search");
      expect(tools[0]!.function.parameters).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      });
    });

    it("does not send strict when strictToolSchemas is not set", async () => {
      const mock = makeMockClient({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok", refusal: null },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

      const client = new OpenAIClient({ client: mock });
      await client.chat({
        messages: [{ role: "user", content: "hi" }],
        model: "gpt-4o-mini",
        tools: [
          {
            name: "greet",
            description: "Greet someone",
            parameters: { type: "object", properties: { name: { type: "string" } } },
          },
        ],
      });

      const createFn = (mock.chat.completions.create as ReturnType<typeof vi.fn>);
      const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;
      const tools = passedParams.tools as Array<{ type: string; function: Record<string, unknown> }>;

      expect(tools[0]!.function.strict).toBeUndefined();
    });
  });

  describe("response schema (structured final answer)", () => {
    it("sends response_format with json_schema when responseSchema is set", async () => {
      const mock = makeMockClient({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"answer":"42","confidence":0.95}', refusal: null },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

      const client = new OpenAIClient({ client: mock });
      const request: LLMRequestExt = {
        messages: [{ role: "user", content: "What is the meaning of life?" }],
        model: "gpt-4o-mini",
        responseSchema: {
          name: "structured_answer",
          schema: {
            type: "object",
            properties: {
              answer: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["answer", "confidence"],
            additionalProperties: false,
          },
        },
      };

      const res = await client.chat(request);

      expect(res.content).toBe('{"answer":"42","confidence":0.95}');

      const createFn = (mock.chat.completions.create as ReturnType<typeof vi.fn>);
      const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;
      const responseFormat = passedParams.response_format as Record<string, unknown>;

      expect(responseFormat).toEqual({
        type: "json_schema",
        json_schema: {
          name: "structured_answer",
          schema: {
            type: "object",
            properties: {
              answer: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["answer", "confidence"],
            additionalProperties: false,
          },
          strict: true,
        },
      });
    });

    it("respects strict: false override on responseSchema", async () => {
      const mock = makeMockClient({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "{}", refusal: null },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

      const client = new OpenAIClient({ client: mock });
      await client.chat({
        messages: [{ role: "user", content: "test" }],
        model: "gpt-4o-mini",
        responseSchema: {
          name: "test_output",
          schema: { type: "object", properties: {} },
          strict: false,
        },
      } as LLMRequestExt);

      const createFn = (mock.chat.completions.create as ReturnType<typeof vi.fn>);
      const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;
      const responseFormat = passedParams.response_format as Record<string, unknown>;
      const jsonSchema = responseFormat.json_schema as Record<string, unknown>;

      expect(jsonSchema.strict).toBe(false);
    });

    it("does not set response_format when responseSchema is not provided", async () => {
      const mock = makeMockClient({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "plain text", refusal: null },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

      const client = new OpenAIClient({ client: mock });
      await client.chat({
        messages: [{ role: "user", content: "hi" }],
        model: "gpt-4o-mini",
      });

      const createFn = (mock.chat.completions.create as ReturnType<typeof vi.fn>);
      const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;

      expect(passedParams.response_format).toBeUndefined();
    });
  });

  describe("combined strict tools + response schema", () => {
    it("handles both strict tools and response schema simultaneously", async () => {
      const mock = makeMockClient({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"result":"done"}', refusal: null },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
      });

      const client = new OpenAIClient({ client: mock });
      const request: LLMRequestExt = {
        messages: [{ role: "user", content: "do something" }],
        model: "gpt-4o-mini",
        tools: [
          {
            name: "action",
            description: "Do action",
            parameters: { type: "object", properties: { x: { type: "number" } }, additionalProperties: false },
          },
        ],
        strictToolSchemas: true,
        responseSchema: {
          name: "output",
          schema: { type: "object", properties: { result: { type: "string" } }, additionalProperties: false },
        },
      };

      await client.chat(request);

      const createFn = (mock.chat.completions.create as ReturnType<typeof vi.fn>);
      const passedParams = createFn.mock.calls[0]![0] as Record<string, unknown>;

      const tools = passedParams.tools as Array<{ type: string; function: Record<string, unknown> }>;
      expect(tools[0]!.function.strict).toBe(true);

      const responseFormat = passedParams.response_format as Record<string, unknown>;
      expect(responseFormat.type).toBe("json_schema");
    });
  });
});
