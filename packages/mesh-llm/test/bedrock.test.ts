import { describe, it, expect, vi } from "vitest";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockClient } from "../src/bedrock.js";

const mockSendWith = (payload: Record<string, unknown>) => {
  const send = vi.fn().mockResolvedValue({
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });
  const client = Object.create(BedrockRuntimeClient.prototype) as BedrockRuntimeClient;
  (client as unknown as { send: typeof send }).send = send;
  return { client, send };
};

describe("BedrockClient", () => {
  it("returns text and usage from a Claude response", async () => {
    const { client } = mockSendWith({
      content: [{ type: "text", text: "Hi!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 4, output_tokens: 2 },
    });

    const c = new BedrockClient({ client });
    const res = await c.chat({
      messages: [{ role: "user", content: "hi" }],
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      maxTokens: 100,
    });

    expect(res.content).toBe("Hi!");
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({ promptTokens: 4, completionTokens: 2, totalTokens: 6 });
  });

  it("rejects non-Anthropic model ids", async () => {
    const { client } = mockSendWith({});
    const c = new BedrockClient({ client });
    await expect(
      c.chat({
        messages: [{ role: "user", content: "hi" }],
        model: "amazon.nova-pro-v1:0",
        maxTokens: 100,
      }),
    ).rejects.toThrow(/only anthropic/i);
  });

  it("sends system messages concatenated and max_tokens respected", async () => {
    const { client, send } = mockSendWith({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const c = new BedrockClient({ client });
    await c.chat({
      messages: [
        { role: "system", content: "Be terse." },
        { role: "system", content: "Be kind." },
        { role: "user", content: "hi" },
      ],
      model: "anthropic.claude-3-5-haiku-20241022-v1:0",
      maxTokens: 256,
    });

    const invoked = send.mock.calls[0]?.[0];
    const body = JSON.parse(new TextDecoder().decode(invoked.input.body));
    expect(body.system).toBe("Be terse.\n\nBe kind.");
    expect(body.max_tokens).toBe(256);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("parses tool_use blocks and maps stop_reason", async () => {
    const { client } = mockSendWith({
      content: [
        { type: "text", text: "" },
        { type: "tool_use", id: "tool_1", name: "search", input: { query: "visa" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 3, output_tokens: 5 },
    });

    const c = new BedrockClient({ client });
    const res = await c.chat({
      messages: [{ role: "user", content: "hi" }],
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      maxTokens: 100,
    });

    expect(res.toolCalls).toEqual([
      { id: "tool_1", name: "search", arguments: { query: "visa" } },
    ]);
    expect(res.finishReason).toBe("tool_calls");
  });

  it("supplies a default max_tokens when omitted", async () => {
    const { client, send } = mockSendWith({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const c = new BedrockClient({ client, defaultMaxTokens: 2048 });
    await c.chat({
      messages: [{ role: "user", content: "hi" }],
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    });

    const body = JSON.parse(new TextDecoder().decode(send.mock.calls[0]?.[0].input.body));
    expect(body.max_tokens).toBe(2048);
  });

  it("defaults name to 'bedrock'", () => {
    const { client } = mockSendWith({});
    const c = new BedrockClient({ client });
    expect(c.name).toBe("bedrock");
  });
});
