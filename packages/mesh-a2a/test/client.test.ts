import { describe, it, expect } from "vitest";
import { A2AClient, A2AClientError, type A2AHttpTransport, type HttpFetchResponse } from "../src/index.js";
import type { Address, Message } from "@corelay/mesh-core";
import type { AgentCard, Task, A2AJsonRpcResponse } from "../src/index.js";

const REMOTE_ADDRESS = "remote/agent" as Address;
const BASE_URL = "http://remote-a2a-agent.example.com";

const MOCK_AGENT_CARD: AgentCard = {
  name: "Remote Agent",
  description: "A remote A2A agent",
  url: BASE_URL,
  version: "1.0.0",
  capabilities: { streaming: false },
  skills: [{ id: "summarize", name: "Summarize", description: "Summarizes text" }],
};

const MOCK_COMPLETED_TASK: Task = {
  id: "task-1",
  sessionId: "sess-1",
  status: {
    state: "completed",
    message: {
      role: "agent",
      parts: [{ type: "text", text: "Summary: the document is about AI." }],
    },
    timestamp: "2026-01-01T00:00:00Z",
  },
  artifacts: [{
    parts: [{ type: "text", text: "Summary: the document is about AI." }],
    index: 0,
    lastChunk: true,
  }],
};

const createMockTransport = (responses: Map<string, HttpFetchResponse>): A2AHttpTransport => ({
  fetch: async (url: string): Promise<HttpFetchResponse> => {
    const response = responses.get(url);
    if (!response) {
      return { status: 500, json: async () => ({ error: "No mock response for " + url }) };
    }
    return response;
  },
});

const jsonResponse = (body: unknown, status = 200): HttpFetchResponse => ({
  status,
  json: async () => body,
});

describe("A2AClient — getAgentCard", () => {
  it("fetches and validates the remote agent card", async () => {
    const transport = createMockTransport(new Map([
      [`${BASE_URL}/.well-known/agent.json`, jsonResponse(MOCK_AGENT_CARD)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    const card = await client.getAgentCard();
    expect(card.name).toBe("Remote Agent");
    expect(card.skills?.[0]?.id).toBe("summarize");
  });

  it("throws on non-200 response", async () => {
    const transport = createMockTransport(new Map([
      [`${BASE_URL}/.well-known/agent.json`, jsonResponse({}, 503)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    await expect(client.getAgentCard()).rejects.toThrow(A2AClientError);
    await expect(client.getAgentCard()).rejects.toThrow("HTTP 503");
  });

  it("throws on invalid agent card shape", async () => {
    const transport = createMockTransport(new Map([
      [`${BASE_URL}/.well-known/agent.json`, jsonResponse({ invalid: true })],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    await expect(client.getAgentCard()).rejects.toThrow(A2AClientError);
  });
});

describe("A2AClient — send (Peer interface)", () => {
  it("sends a message and invokes the reply handler", async () => {
    const rpcResponse: A2AJsonRpcResponse<Task> = {
      jsonrpc: "2.0",
      id: "msg-1",
      result: MOCK_COMPLETED_TASK,
    };

    const transport = createMockTransport(new Map([
      [`${BASE_URL}/`, jsonResponse(rpcResponse)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });

    const replies: Message[] = [];
    client.setReplyHandler(async (msg) => { replies.push(msg); });

    const message: Message = {
      id: "msg-1",
      from: "local/agent" as Address,
      to: REMOTE_ADDRESS,
      kind: "peer",
      content: "Please summarize this document.",
      traceId: "trace-1",
      createdAt: Date.now(),
    };

    await client.send(message);

    expect(replies).toHaveLength(1);
    expect(replies[0]!.content).toContain("Summary: the document is about AI.");
    expect(replies[0]!.from).toBe(REMOTE_ADDRESS);
    expect(replies[0]!.to).toBe("local/agent");
    expect(replies[0]!.kind).toBe("peer");
    expect(replies[0]!.traceId).toBe("trace-1");
    expect(replies[0]!.metadata).toMatchObject({ a2aTaskId: "task-1", a2aState: "completed" });
  });

  it("throws when the remote returns an error", async () => {
    const rpcResponse: A2AJsonRpcResponse = {
      jsonrpc: "2.0",
      id: "msg-2",
      error: { code: -32603, message: "Internal error" },
    };

    const transport = createMockTransport(new Map([
      [`${BASE_URL}/`, jsonResponse(rpcResponse)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    client.setReplyHandler(async () => {});

    const message: Message = {
      id: "msg-2",
      from: "local/agent" as Address,
      to: REMOTE_ADDRESS,
      kind: "peer",
      content: "fail please",
      traceId: "trace-2",
      createdAt: Date.now(),
    };

    await expect(client.send(message)).rejects.toThrow("tasks/send failed");
  });

  it("throws when the remote returns no result", async () => {
    const rpcResponse: A2AJsonRpcResponse = {
      jsonrpc: "2.0",
      id: "msg-3",
    };

    const transport = createMockTransport(new Map([
      [`${BASE_URL}/`, jsonResponse(rpcResponse)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    client.setReplyHandler(async () => {});

    const message: Message = {
      id: "msg-3",
      from: "local/agent" as Address,
      to: REMOTE_ADDRESS,
      kind: "peer",
      content: "empty",
      traceId: "trace-3",
      createdAt: Date.now(),
    };

    await expect(client.send(message)).rejects.toThrow("returned no result");
  });
});

describe("A2AClient — getTask", () => {
  it("retrieves a task by id", async () => {
    const rpcResponse: A2AJsonRpcResponse<Task> = {
      jsonrpc: "2.0",
      id: "task-1",
      result: MOCK_COMPLETED_TASK,
    };

    const transport = createMockTransport(new Map([
      [`${BASE_URL}/`, jsonResponse(rpcResponse)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    const task = await client.getTask("task-1");
    expect(task.id).toBe("task-1");
    expect(task.status.state).toBe("completed");
  });

  it("throws on error response", async () => {
    const rpcResponse: A2AJsonRpcResponse = {
      jsonrpc: "2.0",
      id: "task-x",
      error: { code: -32001, message: "Task not found" },
    };

    const transport = createMockTransport(new Map([
      [`${BASE_URL}/`, jsonResponse(rpcResponse)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    await expect(client.getTask("task-x")).rejects.toThrow("tasks/get failed");
  });
});

describe("A2AClient — cancelTask", () => {
  it("cancels a task by id", async () => {
    const canceledTask: Task = {
      ...MOCK_COMPLETED_TASK,
      status: { state: "canceled", timestamp: "2026-01-01T00:01:00Z" },
    };
    const rpcResponse: A2AJsonRpcResponse<Task> = {
      jsonrpc: "2.0",
      id: "task-1",
      result: canceledTask,
    };

    const transport = createMockTransport(new Map([
      [`${BASE_URL}/`, jsonResponse(rpcResponse)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    const task = await client.cancelTask("task-1");
    expect(task.status.state).toBe("canceled");
  });

  it("throws on cancel error", async () => {
    const rpcResponse: A2AJsonRpcResponse = {
      jsonrpc: "2.0",
      id: "task-1",
      error: { code: -32002, message: "Task not cancelable" },
    };

    const transport = createMockTransport(new Map([
      [`${BASE_URL}/`, jsonResponse(rpcResponse)],
    ]));

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });
    await expect(client.cancelTask("task-1")).rejects.toThrow("tasks/cancel failed");
  });
});
