import { describe, it, expect } from "vitest";
import {
  Agent,
  MemoryInbox,
  PeerRegistry,
  type AgentConfig,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
} from "@corelay/mesh-core";
import { createA2AServer, type A2AHttpRequest } from "../src/index.js";
import type { AgentCard, A2AJsonRpcResponse, Task } from "../src/index.js";

class EchoLLM implements LLMClient {
  readonly name = "echo";
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return {
      content: `Echo: ${lastUser?.content ?? ""}`,
      model: request.model,
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    };
  }
}

const CALLER = "a2a/caller" as const;
const AGENT_ADDRESS = "demo/echo" as const;

const AGENT_CARD: AgentCard = {
  name: "Echo Agent",
  description: "Echoes messages back",
  url: "http://localhost:3000",
  version: "1.0.0",
  capabilities: { streaming: false },
  skills: [{ id: "echo", name: "Echo", description: "Echoes input" }],
};

const buildServer = async () => {
  const registry = new PeerRegistry();
  const config: AgentConfig = {
    name: "echo",
    description: "echoes",
    prompt: "repeat the user message exactly",
    model: "test",
    maxResponseTokens: 100,
    welcomeMessage: "",
    guardrails: "",
    tools: [],
    capabilities: [{ kind: "peer", address: CALLER }],
  };
  const agent = new Agent(AGENT_ADDRESS, config, new EchoLLM(), new MemoryInbox(), registry);
  registry.register(agent);
  await agent.start();

  const handler = createA2AServer({
    agentCard: AGENT_CARD,
    registry,
    agentAddress: AGENT_ADDRESS,
    callerAddress: CALLER,
    timeoutMs: 5000,
  });

  return { handler, registry };
};

const jsonRpcRequest = (method: string, params: unknown): A2AHttpRequest => ({
  method: "POST",
  path: "/",
  body: { jsonrpc: "2.0", id: "req-1", method, params },
});

describe("A2A Server — Agent Card", () => {
  it("returns the agent card on GET /.well-known/agent.json", async () => {
    const { handler } = await buildServer();
    const response = await handler({
      method: "GET",
      path: "/.well-known/agent.json",
      body: null,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(AGENT_CARD);
  });

  it("returns 404 for unknown paths", async () => {
    const { handler } = await buildServer();
    const response = await handler({
      method: "GET",
      path: "/unknown",
      body: null,
    });
    expect(response.status).toBe(404);
  });
});

describe("A2A Server — tasks/send", () => {
  it("executes a task and returns completed status", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/send", {
      id: "task-1",
      message: { role: "user", parts: [{ type: "text", text: "hello world" }] },
    }));

    expect(response.status).toBe(200);
    const body = response.body as A2AJsonRpcResponse<Task>;
    expect(body.result?.id).toBe("task-1");
    expect(body.result?.status.state).toBe("completed");
    expect(body.result?.status.message?.role).toBe("agent");
    expect(body.result?.status.message?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Echo: hello world"),
    });
  });

  it("includes artifacts with the agent reply", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/send", {
      id: "task-2",
      message: { role: "user", parts: [{ type: "text", text: "test" }] },
    }));

    const body = response.body as A2AJsonRpcResponse<Task>;
    expect(body.result?.artifacts).toHaveLength(1);
    expect(body.result?.artifacts?.[0]?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Echo: test"),
    });
  });

  it("preserves sessionId in the task", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/send", {
      id: "task-3",
      sessionId: "session-abc",
      message: { role: "user", parts: [{ type: "text", text: "hi" }] },
    }));

    const body = response.body as A2AJsonRpcResponse<Task>;
    expect(body.result?.sessionId).toBe("session-abc");
  });

  it("returns error for invalid params", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/send", {
      id: 123,
      message: "not a message object",
    }));

    expect(response.status).toBe(400);
    const body = response.body as A2AJsonRpcResponse;
    expect(body.error?.code).toBe(-32602);
  });
});

describe("A2A Server — tasks/get", () => {
  it("retrieves a previously submitted task", async () => {
    const { handler } = await buildServer();

    await handler(jsonRpcRequest("tasks/send", {
      id: "task-get-1",
      message: { role: "user", parts: [{ type: "text", text: "stored" }] },
    }));

    const response = await handler(jsonRpcRequest("tasks/get", { id: "task-get-1" }));
    expect(response.status).toBe(200);
    const body = response.body as A2AJsonRpcResponse<Task>;
    expect(body.result?.id).toBe("task-get-1");
    expect(body.result?.status.state).toBe("completed");
  });

  it("returns error for unknown task id", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/get", { id: "nonexistent" }));
    expect(response.status).toBe(404);
    const body = response.body as A2AJsonRpcResponse;
    expect(body.error?.code).toBe(-32001);
  });
});

describe("A2A Server — tasks/cancel", () => {
  it("returns error when cancelling a completed task", async () => {
    const { handler } = await buildServer();

    await handler(jsonRpcRequest("tasks/send", {
      id: "task-cancel-1",
      message: { role: "user", parts: [{ type: "text", text: "done" }] },
    }));

    const response = await handler(jsonRpcRequest("tasks/cancel", { id: "task-cancel-1" }));
    expect(response.status).toBe(409);
    const body = response.body as A2AJsonRpcResponse;
    expect(body.error?.code).toBe(-32002);
  });

  it("returns error for unknown task id", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/cancel", { id: "ghost" }));
    expect(response.status).toBe(404);
    const body = response.body as A2AJsonRpcResponse;
    expect(body.error?.code).toBe(-32001);
  });
});

describe("A2A Server — JSON-RPC errors", () => {
  it("rejects invalid JSON-RPC envelope", async () => {
    const { handler } = await buildServer();
    const response = await handler({
      method: "POST",
      path: "/",
      body: { not: "valid" },
    });
    expect(response.status).toBe(400);
    const body = response.body as A2AJsonRpcResponse;
    expect(body.error?.code).toBe(-32600);
  });

  it("rejects unknown methods", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/unknown", {}));
    expect(response.status).toBe(404);
    const body = response.body as A2AJsonRpcResponse;
    expect(body.error?.code).toBe(-32601);
  });
});
