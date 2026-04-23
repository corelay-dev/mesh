import { describe, it, expect } from "vitest";
import { Agent } from "../src/agent.js";
import { MemoryInbox } from "../src/memory-inbox.js";
import type { AgentConfig } from "../src/agent-config.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/llm.js";
import type { Message } from "../src/message.js";

const mockLLM = (reply: string): LLMClient => ({
  name: "mock",
  async chat(_req: LLMRequest): Promise<LLMResponse> {
    return {
      content: reply,
      model: _req.model,
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: "stop",
    };
  },
});

const baseConfig: AgentConfig = {
  name: "test-agent",
  description: "A test agent",
  prompt: "You are helpful.",
  model: "gpt-4o-mini",
  maxResponseTokens: 100,
  welcomeMessage: "",
  guardrails: "",
  tools: [],
  capabilities: [],
};

const msg = (content: string): Message => ({
  id: "m-1",
  from: "test/user",
  to: "test/agent",
  kind: "user",
  content,
  traceId: "t-1",
  createdAt: 0,
});

describe("Agent", () => {
  it("responds to an inbound message via the LLM", async () => {
    const agent = new Agent("test/agent", baseConfig, mockLLM("the capital is Abuja"), new MemoryInbox());
    await agent.start();
    await agent.send(msg("What's the capital of Nigeria?"));
    await new Promise((r) => setImmediate(r));

    expect(agent.lastReply).toBeDefined();
    expect(agent.lastReply?.content).toBe("the capital is Abuja");
    expect(agent.lastReply?.kind).toBe("assistant");
    expect(agent.lastReply?.from).toBe("test/agent");
    expect(agent.lastReply?.to).toBe("test/user");
    expect(agent.lastReply?.traceId).toBe("t-1");
  });

  it("passes the system prompt and user message to the LLM", async () => {
    const captured: LLMRequest[] = [];
    const llm: LLMClient = {
      name: "mock",
      async chat(req) {
        captured.push(req);
        return {
          content: "ok",
          model: req.model,
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: "stop",
        };
      },
    };
    const agent = new Agent(
      "test/agent",
      { ...baseConfig, prompt: "Be concise." },
      llm,
      new MemoryInbox(),
    );
    await agent.start();
    await agent.send(msg("hello"));
    await new Promise((r) => setImmediate(r));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hello" },
    ]);
    expect(captured[0]?.model).toBe("gpt-4o-mini");
    expect(captured[0]?.maxTokens).toBe(100);
  });

  it("processes multiple inbound messages in order", async () => {
    const replies: string[] = [];
    let count = 0;
    const llm: LLMClient = {
      name: "mock",
      async chat() {
        count += 1;
        return {
          content: `reply-${count}`,
          model: "gpt-4o-mini",
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: "stop",
        };
      },
    };
    const agent = new Agent("test/agent", baseConfig, llm, new MemoryInbox());
    await agent.start();
    for (let i = 0; i < 3; i++) {
      await agent.send({ ...msg(`q-${i}`), id: `m-${i}` });
    }
    // give it room to drain
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setImmediate(r));
    }
    replies.push(agent.lastReply!.content);

    expect(count).toBe(3);
    expect(replies).toEqual(["reply-3"]);
  });
});
