import { describe, it, expect } from "vitest";
import {
  AgentCardSchema,
  TaskSendParamsSchema,
  TaskQueryParamsSchema,
  TaskCancelParamsSchema,
  A2AMessageSchema,
  TaskSchema,
  PartSchema,
  JsonRpcRequestSchema,
} from "../src/index.js";

describe("A2A Schemas — AgentCard", () => {
  it("validates a valid agent card", () => {
    const card = {
      name: "Test Agent",
      url: "http://example.com",
      version: "1.0.0",
    };
    const result = AgentCardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it("validates a full agent card with all fields", () => {
    const card = {
      name: "Full Agent",
      description: "A fully-specified agent",
      url: "http://example.com",
      version: "2.0.0",
      capabilities: { streaming: true, pushNotifications: false },
      authentication: { schemes: ["bearer"] },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [{ id: "s1", name: "Skill 1", description: "Does things", tags: ["ai"] }],
    };
    const result = AgentCardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it("rejects a card missing required fields", () => {
    const result = AgentCardSchema.safeParse({ name: "No URL" });
    expect(result.success).toBe(false);
  });
});

describe("A2A Schemas — Parts", () => {
  it("validates a text part", () => {
    const result = PartSchema.safeParse({ type: "text", text: "hello" });
    expect(result.success).toBe(true);
  });

  it("validates a file part", () => {
    const result = PartSchema.safeParse({
      type: "file",
      file: { name: "doc.pdf", mimeType: "application/pdf", uri: "http://example.com/doc.pdf" },
    });
    expect(result.success).toBe(true);
  });

  it("validates a data part", () => {
    const result = PartSchema.safeParse({ type: "data", data: { key: "value" } });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown part type", () => {
    const result = PartSchema.safeParse({ type: "unknown", foo: "bar" });
    expect(result.success).toBe(false);
  });
});

describe("A2A Schemas — A2AMessage", () => {
  it("validates a user message", () => {
    const msg = { role: "user", parts: [{ type: "text", text: "hi" }] };
    const result = A2AMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it("validates an agent message with metadata", () => {
    const msg = {
      role: "agent",
      parts: [{ type: "text", text: "response" }],
      metadata: { custom: true },
    };
    const result = A2AMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it("rejects invalid role", () => {
    const msg = { role: "system", parts: [{ type: "text", text: "x" }] };
    const result = A2AMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});

describe("A2A Schemas — TaskSendParams", () => {
  it("validates minimal send params", () => {
    const params = {
      id: "task-1",
      message: { role: "user", parts: [{ type: "text", text: "go" }] },
    };
    const result = TaskSendParamsSchema.safeParse(params);
    expect(result.success).toBe(true);
  });

  it("validates send params with all optional fields", () => {
    const params = {
      id: "task-2",
      sessionId: "sess-1",
      message: { role: "user", parts: [{ type: "text", text: "go" }] },
      acceptedOutputModes: ["text/plain"],
      pushNotification: { url: "http://callback.example.com", token: "abc" },
      metadata: { priority: "high" },
    };
    const result = TaskSendParamsSchema.safeParse(params);
    expect(result.success).toBe(true);
  });

  it("rejects missing message", () => {
    const result = TaskSendParamsSchema.safeParse({ id: "task-3" });
    expect(result.success).toBe(false);
  });
});

describe("A2A Schemas — TaskQueryParams", () => {
  it("validates minimal query params", () => {
    const result = TaskQueryParamsSchema.safeParse({ id: "task-1" });
    expect(result.success).toBe(true);
  });

  it("validates query with historyLength", () => {
    const result = TaskQueryParamsSchema.safeParse({ id: "task-1", historyLength: 10 });
    expect(result.success).toBe(true);
  });
});

describe("A2A Schemas — TaskCancelParams", () => {
  it("validates cancel params", () => {
    const result = TaskCancelParamsSchema.safeParse({ id: "task-1" });
    expect(result.success).toBe(true);
  });
});

describe("A2A Schemas — Task", () => {
  it("validates a completed task", () => {
    const task = {
      id: "task-1",
      status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
      artifacts: [{ parts: [{ type: "text", text: "result" }], index: 0, lastChunk: true }],
    };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it("validates a task with history", () => {
    const task = {
      id: "task-2",
      sessionId: "sess-1",
      status: { state: "working" },
      history: [
        { role: "user", parts: [{ type: "text", text: "do it" }] },
        { role: "agent", parts: [{ type: "text", text: "on it" }] },
      ],
    };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });
});

describe("A2A Schemas — JsonRpcRequest", () => {
  it("validates a valid request", () => {
    const req = { jsonrpc: "2.0", id: "1", method: "tasks/send", params: {} };
    const result = JsonRpcRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
  });

  it("validates with numeric id", () => {
    const req = { jsonrpc: "2.0", id: 42, method: "tasks/get" };
    const result = JsonRpcRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
  });

  it("rejects invalid jsonrpc version", () => {
    const req = { jsonrpc: "1.0", id: "1", method: "x" };
    const result = JsonRpcRequestSchema.safeParse(req);
    expect(result.success).toBe(false);
  });
});
