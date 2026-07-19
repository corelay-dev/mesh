import { describe, it, expect } from "vitest";
import {
  A2AClient,
  A2AClientError,
  type A2AHttpTransport,
  type HttpFetchResponse,
} from "../src/index.js";
import type { Address } from "@corelay/mesh-core";
import type {
  A2AJsonRpcResponse,
  Task,
  TaskStreamingEvent,
} from "../src/index.js";

const REMOTE_ADDRESS = "remote/agent" as Address;
const BASE_URL = "http://remote-a2a-agent.example.com";

/** Create a mock SSE stream from an array of events */
const createSseStream = (events: TaskStreamingEvent[]): AsyncIterable<string> => ({
  [Symbol.asyncIterator]() {
    let index = 0;
    return {
      async next(): Promise<IteratorResult<string>> {
        if (index < events.length) {
          const event = events[index++]!;
          return { value: `data: ${JSON.stringify(event)}\n\n`, done: false };
        }
        return { value: undefined as unknown as string, done: true };
      },
    };
  },
});

const createStreamingTransport = (events: TaskStreamingEvent[]): A2AHttpTransport => ({
  async fetch(): Promise<HttpFetchResponse> {
    return {
      status: 200,
      json: async () => ({}),
      body: createSseStream(events),
    };
  },
});

const jsonResponse = (body: unknown, status = 200): HttpFetchResponse => ({
  status,
  json: async () => body,
});

describe("A2AClient — sendSubscribe (streaming)", () => {
  it("yields streaming events from SSE response", async () => {
    const events: TaskStreamingEvent[] = [
      { type: "status", taskId: "t-1", status: { state: "working", timestamp: "2026-01-01T00:00:00Z" }, final: false },
      { type: "artifact", taskId: "t-1", artifact: { parts: [{ type: "text", text: "chunk-1" }], index: 0, lastChunk: false } },
      { type: "artifact", taskId: "t-1", artifact: { parts: [{ type: "text", text: "chunk-2" }], index: 0, lastChunk: true } },
      { type: "status", taskId: "t-1", status: { state: "completed", message: { role: "agent", parts: [{ type: "text", text: "done" }] }, timestamp: "2026-01-01T00:00:01Z" }, final: true },
    ];

    const transport = createStreamingTransport(events);
    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });

    const received: TaskStreamingEvent[] = [];
    for await (const event of client.sendSubscribe({
      id: "t-1",
      message: { role: "user", parts: [{ type: "text", text: "hello" }] },
    })) {
      received.push(event);
    }

    expect(received).toHaveLength(4);
    expect(received[0]!.type).toBe("status");
    if (received[0]!.type === "status") {
      expect(received[0]!.status.state).toBe("working");
    }
    expect(received[1]!.type).toBe("artifact");
    expect(received[2]!.type).toBe("artifact");
    expect(received[3]!.type).toBe("status");
    if (received[3]!.type === "status") {
      expect(received[3]!.status.state).toBe("completed");
      expect(received[3]!.final).toBe(true);
    }
  });

  it("throws on non-200 response without body stream", async () => {
    const errorResponse: A2AJsonRpcResponse = {
      jsonrpc: "2.0",
      id: "t-err",
      error: { code: -32602, message: "Invalid params" },
    };

    const transport: A2AHttpTransport = {
      async fetch(): Promise<HttpFetchResponse> {
        return {
          status: 400,
          json: async () => errorResponse,
        };
      },
    };

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });

    const iter = client.sendSubscribe({
      id: "t-err",
      message: { role: "user", parts: [{ type: "text", text: "fail" }] },
    });

    await expect(async () => {
      for await (const _event of iter) { /* drain */ }
    }).rejects.toThrow(A2AClientError);
  });

  it("handles chunked SSE data split across multiple chunks", async () => {
    // Simulate a transport that delivers SSE data in irregular chunks
    const fullData = [
      `data: ${JSON.stringify({ type: "status", taskId: "t-2", status: { state: "working" }, final: false })}\n\n`,
      `data: ${JSON.stringify({ type: "status", taskId: "t-2", status: { state: "completed" }, final: true })}\n\n`,
    ].join("");

    // Split into 3 irregular chunks
    const chunks = [
      fullData.slice(0, 20),
      fullData.slice(20, 80),
      fullData.slice(80),
    ];

    const transport: A2AHttpTransport = {
      async fetch(): Promise<HttpFetchResponse> {
        return {
          status: 200,
          json: async () => ({}),
          body: {
            [Symbol.asyncIterator]() {
              let i = 0;
              return {
                async next(): Promise<IteratorResult<string>> {
                  if (i < chunks.length) {
                    return { value: chunks[i++]!, done: false };
                  }
                  return { value: undefined as unknown as string, done: true };
                },
              };
            },
          },
        };
      },
    };

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });

    const received: TaskStreamingEvent[] = [];
    for await (const event of client.sendSubscribe({
      id: "t-2",
      message: { role: "user", parts: [{ type: "text", text: "chunk test" }] },
    })) {
      received.push(event);
    }

    expect(received).toHaveLength(2);
    expect(received[0]!.type).toBe("status");
    expect(received[1]!.type).toBe("status");
  });

  it("skips malformed SSE frames gracefully", async () => {
    const transport: A2AHttpTransport = {
      async fetch(): Promise<HttpFetchResponse> {
        return {
          status: 200,
          json: async () => ({}),
          body: {
            [Symbol.asyncIterator]() {
              const frames = [
                `data: not-json\n\n`,
                `data: ${JSON.stringify({ type: "status", taskId: "t-3", status: { state: "completed" }, final: true })}\n\n`,
              ];
              let i = 0;
              return {
                async next(): Promise<IteratorResult<string>> {
                  if (i < frames.length) {
                    return { value: frames[i++]!, done: false };
                  }
                  return { value: undefined as unknown as string, done: true };
                },
              };
            },
          },
        };
      },
    };

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });

    const received: TaskStreamingEvent[] = [];
    for await (const event of client.sendSubscribe({
      id: "t-3",
      message: { role: "user", parts: [{ type: "text", text: "malformed test" }] },
    })) {
      received.push(event);
    }

    // Only the valid event should be yielded
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe("status");
  });
});

describe("A2AClient — resubscribe", () => {
  it("yields events from resubscribe SSE stream", async () => {
    const events: TaskStreamingEvent[] = [
      { type: "artifact", taskId: "t-resub", artifact: { parts: [{ type: "text", text: "result" }], index: 0, lastChunk: true } },
      { type: "status", taskId: "t-resub", status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" }, final: true },
    ];

    const transport = createStreamingTransport(events);
    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });

    const received: TaskStreamingEvent[] = [];
    for await (const event of client.resubscribe("t-resub")) {
      received.push(event);
    }

    expect(received).toHaveLength(2);
    expect(received[0]!.type).toBe("artifact");
    expect(received[1]!.type).toBe("status");
    if (received[1]!.type === "status") {
      expect(received[1]!.final).toBe(true);
    }
  });

  it("throws when task not found", async () => {
    const errorResponse: A2AJsonRpcResponse = {
      jsonrpc: "2.0",
      id: "t-missing",
      error: { code: -32001, message: "Task not found" },
    };

    const transport: A2AHttpTransport = {
      async fetch(): Promise<HttpFetchResponse> {
        return {
          status: 404,
          json: async () => errorResponse,
        };
      },
    };

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });

    await expect(async () => {
      for await (const _event of client.resubscribe("t-missing")) { /* drain */ }
    }).rejects.toThrow(A2AClientError);
    await expect(async () => {
      for await (const _event of client.resubscribe("t-missing")) { /* drain */ }
    }).rejects.toThrow("resubscribe failed");
  });

  it("passes metadata to the resubscribe request", async () => {
    let capturedBody: string | undefined;
    const events: TaskStreamingEvent[] = [
      { type: "status", taskId: "t-meta", status: { state: "completed" }, final: true },
    ];

    const transport: A2AHttpTransport = {
      async fetch(_url: string, init: { body?: string }): Promise<HttpFetchResponse> {
        capturedBody = init.body;
        return {
          status: 200,
          json: async () => ({}),
          body: createSseStream(events),
        };
      },
    };

    const client = new A2AClient({ baseUrl: BASE_URL, transport, address: REMOTE_ADDRESS });

    const received: TaskStreamingEvent[] = [];
    for await (const event of client.resubscribe("t-meta", { correlationId: "abc" })) {
      received.push(event);
    }

    expect(received).toHaveLength(1);
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.params.metadata).toEqual({ correlationId: "abc" });
  });
});
