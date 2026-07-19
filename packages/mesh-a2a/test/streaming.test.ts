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
import {
  createA2AServer,
  isSseResponse,
  type A2AHttpRequest,
  type A2ASseResponse,
  type A2AHttpResponse,
  type PushNotificationTransport,
} from "../src/index.js";
import type {
  AgentCard,
  A2AJsonRpcResponse,
  Task,
  TaskStreamingEvent,
} from "../src/index.js";

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
  capabilities: { streaming: true, pushNotifications: true },
  skills: [{ id: "echo", name: "Echo", description: "Echoes input" }],
};

const buildServer = async (opts?: { pushTransport?: PushNotificationTransport }) => {
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
    pushNotificationTransport: opts?.pushTransport,
  });

  return { handler, registry };
};

const jsonRpcRequest = (method: string, params: unknown): A2AHttpRequest => ({
  method: "POST",
  path: "/",
  body: { jsonrpc: "2.0", id: "req-1", method, params },
});

/** Collect all SSE events from a streaming response */
const collectSseEvents = async (response: A2ASseResponse): Promise<TaskStreamingEvent[]> => {
  const events: TaskStreamingEvent[] = [];
  for await (const chunk of response.body) {
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
    for (const line of lines) {
      const json = line.slice(6);
      events.push(JSON.parse(json) as TaskStreamingEvent);
    }
  }
  return events;
};

describe("A2A Server — tasks/sendSubscribe (streaming)", () => {
  it("returns an SSE stream response", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/sendSubscribe", {
      id: "stream-1",
      message: { role: "user", parts: [{ type: "text", text: "hello" }] },
    }));

    expect(isSseResponse(response)).toBe(true);
    const sse = response as A2ASseResponse;
    expect(sse.status).toBe(200);
    expect(sse.headers["content-type"]).toBe("text/event-stream");
  });

  it("streams working status, artifact, then completed status events", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/sendSubscribe", {
      id: "stream-2",
      message: { role: "user", parts: [{ type: "text", text: "ping" }] },
    }));

    const sse = response as A2ASseResponse;
    const events = await collectSseEvents(sse);

    // Should have at least: working status, artifact, completed status
    expect(events.length).toBeGreaterThanOrEqual(3);

    const statusEvents = events.filter((e) => e.type === "status");
    const artifactEvents = events.filter((e) => e.type === "artifact");

    // First event is working
    expect(statusEvents[0]!.status.state).toBe("working");
    expect(statusEvents[0]!.final).toBe(false);

    // Last status event is completed and final
    const lastStatus = statusEvents[statusEvents.length - 1]!;
    expect(lastStatus.status.state).toBe("completed");
    expect(lastStatus.final).toBe(true);

    // Artifact with echoed content
    expect(artifactEvents.length).toBeGreaterThanOrEqual(1);
    const artParts = artifactEvents[0]!.artifact.parts;
    expect(artParts[0]!.type).toBe("text");
    if (artParts[0]!.type === "text") {
      expect(artParts[0]!.text).toContain("Echo: ping");
    }
  });

  it("preserves sessionId in the stored task", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/sendSubscribe", {
      id: "stream-3",
      sessionId: "sess-xyz",
      message: { role: "user", parts: [{ type: "text", text: "hi" }] },
    }));

    // Must consume the stream to let the task complete
    const sse = response as A2ASseResponse;
    await collectSseEvents(sse);

    // After streaming completes, task should be retrievable
    const getResponse = await handler(jsonRpcRequest("tasks/get", { id: "stream-3" }));
    const body = (getResponse as A2AHttpResponse).body as A2AJsonRpcResponse<Task>;
    expect(body.result?.sessionId).toBe("sess-xyz");
    expect(body.result?.status.state).toBe("completed");
  });

  it("returns error for invalid params", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/sendSubscribe", {
      id: 123, // invalid: should be string
      message: "not valid",
    }));

    expect(isSseResponse(response)).toBe(false);
    const httpResponse = response as A2AHttpResponse;
    expect(httpResponse.status).toBe(400);
    const body = httpResponse.body as A2AJsonRpcResponse;
    expect(body.error?.code).toBe(-32602);
  });
});

describe("A2A Server — tasks/resubscribe", () => {
  it("returns current state for a completed task as a single-shot stream", async () => {
    const { handler } = await buildServer();

    // First send a task to completion
    await handler(jsonRpcRequest("tasks/send", {
      id: "resub-1",
      message: { role: "user", parts: [{ type: "text", text: "done" }] },
    }));

    // Now resubscribe
    const response = await handler(jsonRpcRequest("tasks/resubscribe", { id: "resub-1" }));
    expect(isSseResponse(response)).toBe(true);

    const sse = response as A2ASseResponse;
    const events = await collectSseEvents(sse);

    // Should include artifact + final completed status
    const statusEvents = events.filter((e) => e.type === "status");
    const artifactEvents = events.filter((e) => e.type === "artifact");

    expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    expect(statusEvents[statusEvents.length - 1]!.status.state).toBe("completed");
    expect(statusEvents[statusEvents.length - 1]!.final).toBe(true);
    expect(artifactEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("returns error for unknown task id", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/resubscribe", { id: "nonexistent" }));

    expect(isSseResponse(response)).toBe(false);
    const httpResponse = response as A2AHttpResponse;
    expect(httpResponse.status).toBe(404);
    const body = httpResponse.body as A2AJsonRpcResponse;
    expect(body.error?.code).toBe(-32001);
  });

  it("returns error for invalid params", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/resubscribe", {
      id: 999, // invalid: should be string
    }));

    expect(isSseResponse(response)).toBe(false);
    const httpResponse = response as A2AHttpResponse;
    expect(httpResponse.status).toBe(400);
  });
});

describe("A2A Server — Push Notifications", () => {
  it("delivers task events to the configured push webhook", async () => {
    const pushCalls: Array<{ url: string; body: unknown; headers?: Record<string, string> }> = [];
    const pushTransport: PushNotificationTransport = {
      async post(url, body, headers) {
        pushCalls.push({ url, body, headers });
        return { status: 200 };
      },
    };

    const { handler } = await buildServer({ pushTransport });

    await handler(jsonRpcRequest("tasks/send", {
      id: "push-1",
      message: { role: "user", parts: [{ type: "text", text: "hello" }] },
      pushNotification: { url: "https://webhook.example.com/notify", token: "secret-token" },
    }));

    // Push notifications should have been delivered
    expect(pushCalls.length).toBeGreaterThanOrEqual(1);

    // Verify the webhook URL was called
    expect(pushCalls.every((c) => c.url === "https://webhook.example.com/notify")).toBe(true);

    // Verify auth header was included
    expect(pushCalls.every((c) => c.headers?.["authorization"] === "Bearer secret-token")).toBe(true);

    // Final status event should be "completed"
    const statusEvents = pushCalls.filter(
      (c) => (c.body as TaskStreamingEvent).type === "status",
    );
    const lastStatusBody = statusEvents[statusEvents.length - 1]!.body as TaskStreamingEvent;
    expect(lastStatusBody.type).toBe("status");
    if (lastStatusBody.type === "status") {
      expect(lastStatusBody.status.state).toBe("completed");
      expect(lastStatusBody.final).toBe(true);
    }
  });

  it("delivers push notifications for streaming tasks via sendSubscribe", async () => {
    const pushCalls: Array<{ url: string; body: unknown }> = [];
    const pushTransport: PushNotificationTransport = {
      async post(url, body) {
        pushCalls.push({ url, body });
        return { status: 200 };
      },
    };

    const { handler } = await buildServer({ pushTransport });

    const response = await handler(jsonRpcRequest("tasks/sendSubscribe", {
      id: "push-stream-1",
      message: { role: "user", parts: [{ type: "text", text: "stream me" }] },
      pushNotification: { url: "https://webhook.example.com/stream" },
    }));

    // Consume the SSE stream to completion
    const sse = response as A2ASseResponse;
    await collectSseEvents(sse);

    // Push calls should have been made
    expect(pushCalls.length).toBeGreaterThanOrEqual(1);
    expect(pushCalls[0]!.url).toBe("https://webhook.example.com/stream");
  });

  it("does not fail when push delivery errors", async () => {
    const pushTransport: PushNotificationTransport = {
      async post() {
        throw new Error("webhook down");
      },
    };

    const { handler } = await buildServer({ pushTransport });

    // Should not throw despite push failure
    const response = await handler(jsonRpcRequest("tasks/send", {
      id: "push-fail-1",
      message: { role: "user", parts: [{ type: "text", text: "go" }] },
      pushNotification: { url: "https://dead.webhook.example.com" },
    }));

    const httpResponse = response as A2AHttpResponse;
    expect(httpResponse.status).toBe(200);
    const body = httpResponse.body as A2AJsonRpcResponse<Task>;
    expect(body.result?.status.state).toBe("completed");
  });

  it("skips push when no transport is configured", async () => {
    const { handler } = await buildServer(); // no pushTransport

    // Should work fine without a push transport
    const response = await handler(jsonRpcRequest("tasks/send", {
      id: "no-push-1",
      message: { role: "user", parts: [{ type: "text", text: "go" }] },
      pushNotification: { url: "https://example.com/noop" },
    }));

    const httpResponse = response as A2AHttpResponse;
    expect(httpResponse.status).toBe(200);
  });

  it("does not include auth header when token is not provided", async () => {
    const pushCalls: Array<{ headers?: Record<string, string> }> = [];
    const pushTransport: PushNotificationTransport = {
      async post(_url, _body, headers) {
        pushCalls.push({ headers });
        return { status: 200 };
      },
    };

    const { handler } = await buildServer({ pushTransport });

    await handler(jsonRpcRequest("tasks/send", {
      id: "push-notoken-1",
      message: { role: "user", parts: [{ type: "text", text: "test" }] },
      pushNotification: { url: "https://webhook.example.com/open" },
    }));

    expect(pushCalls.length).toBeGreaterThanOrEqual(1);
    // No auth header when token is omitted
    expect(pushCalls[0]!.headers?.["authorization"]).toBeUndefined();
  });
});

describe("A2A Server — backward compatibility", () => {
  it("existing tasks/send still works and returns JSON response (not SSE)", async () => {
    const { handler } = await buildServer();
    const response = await handler(jsonRpcRequest("tasks/send", {
      id: "compat-1",
      message: { role: "user", parts: [{ type: "text", text: "legacy" }] },
    }));

    expect(isSseResponse(response)).toBe(false);
    const httpResponse = response as A2AHttpResponse;
    expect(httpResponse.status).toBe(200);
    const body = httpResponse.body as A2AJsonRpcResponse<Task>;
    expect(body.result?.status.state).toBe("completed");
  });

  it("tasks/get still works after sendSubscribe", async () => {
    const { handler } = await buildServer();

    // Create via streaming
    const sseResponse = await handler(jsonRpcRequest("tasks/sendSubscribe", {
      id: "compat-2",
      message: { role: "user", parts: [{ type: "text", text: "streamed" }] },
    }));
    await collectSseEvents(sseResponse as A2ASseResponse);

    // Retrieve via standard get
    const getResponse = await handler(jsonRpcRequest("tasks/get", { id: "compat-2" }));
    const body = (getResponse as A2AHttpResponse).body as A2AJsonRpcResponse<Task>;
    expect(body.result?.status.state).toBe("completed");
  });
});
