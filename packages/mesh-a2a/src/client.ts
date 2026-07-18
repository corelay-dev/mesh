import type { Address, Message, Peer } from "@corelay/mesh-core";
import type {
  AgentCard,
  Task,
  A2AJsonRpcResponse,
} from "./schemas.js";
import { AgentCardSchema } from "./schemas.js";

/**
 * HTTP transport abstraction for the A2A client.
 * Allows injection of mocked transports in tests.
 */
export interface A2AHttpTransport {
  fetch(url: string, init: HttpFetchInit): Promise<HttpFetchResponse>;
}

export interface HttpFetchInit {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpFetchResponse {
  status: number;
  json(): Promise<unknown>;
}

export interface A2AClientConfig {
  /** Base URL of the remote A2A agent (e.g. "http://agent.example.com"). */
  baseUrl: string;
  /** HTTP transport implementation. Defaults to global fetch if available. */
  transport: A2AHttpTransport;
  /** Mesh address to assign to this remote agent Peer. */
  address: Address;
  /** Timeout for requests, ms. Default 30000. */
  timeoutMs?: number;
}

/**
 * A2A client that wraps a remote A2A agent as a Mesh Peer.
 *
 * When a Mesh agent sends a message to this Peer, it translates to an A2A
 * tasks/send JSON-RPC call to the remote agent. The reply (task result) is
 * sent back as a message to the sender via the provided reply callback.
 */
export class A2AClient implements Peer {
  readonly address: Address;
  private readonly baseUrl: string;
  private readonly transport: A2AHttpTransport;
  private readonly timeoutMs: number;
  private onReply: ((message: Message) => Promise<void>) | undefined;

  constructor(config: A2AClientConfig) {
    this.address = config.address;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.transport = config.transport;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  /**
   * Register a callback for sending replies back to the Mesh.
   * Typically the PeerRegistry.deliver or a direct peer.send.
   */
  setReplyHandler(handler: (message: Message) => Promise<void>): void {
    this.onReply = handler;
  }

  /**
   * Fetch the remote agent's card from /.well-known/agent.json.
   */
  async getAgentCard(): Promise<AgentCard> {
    const response = await this.transport.fetch(
      `${this.baseUrl}/.well-known/agent.json`,
      { method: "GET", headers: { accept: "application/json" } },
    );
    if (response.status !== 200) {
      throw new A2AClientError("FETCH_CARD_FAILED", `Failed to fetch agent card: HTTP ${response.status}`);
    }
    const body = await response.json();
    const parsed = AgentCardSchema.safeParse(body);
    if (!parsed.success) {
      throw new A2AClientError("INVALID_CARD", `Invalid agent card: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /**
   * Implements Peer.send — translates a Mesh message into an A2A tasks/send call.
   */
  async send(message: Message): Promise<void> {
    const taskId = message.id;
    const rpcRequest = {
      jsonrpc: "2.0" as const,
      id: taskId,
      method: "tasks/send",
      params: {
        id: taskId,
        sessionId: message.traceId,
        message: {
          role: "user" as const,
          parts: [{ type: "text" as const, text: message.content }],
        },
      },
    };

    const response = await this.transport.fetch(`${this.baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rpcRequest),
    });

    const body = await response.json() as A2AJsonRpcResponse<Task>;

    if (body.error) {
      throw new A2AClientError(
        "TASK_SEND_FAILED",
        `A2A tasks/send failed: [${body.error.code}] ${body.error.message}`,
      );
    }

    const task = body.result;
    if (!task) {
      throw new A2AClientError("EMPTY_RESPONSE", "A2A tasks/send returned no result");
    }

    if (this.onReply) {
      const replyText = extractTextFromTask(task);
      const reply: Message = {
        id: crypto.randomUUID(),
        from: this.address,
        to: message.from,
        kind: "peer",
        content: replyText,
        traceId: message.traceId,
        createdAt: Date.now(),
        metadata: { a2aTaskId: task.id, a2aState: task.status.state },
      };
      await this.onReply(reply);
    } else {
      throw new A2AClientError(
        "NO_REPLY_HANDLER",
        `NO_REPLY_HANDLER: Task ${task.id} completed but no reply handler is registered — reply dropped`,
      );
    }
  }

  /**
   * Query a task's status from the remote A2A agent.
   */
  async getTask(taskId: string): Promise<Task> {
    const rpcRequest = {
      jsonrpc: "2.0" as const,
      id: taskId,
      method: "tasks/get",
      params: { id: taskId },
    };

    const response = await this.transport.fetch(`${this.baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rpcRequest),
    });

    const body = await response.json() as A2AJsonRpcResponse<Task>;
    if (body.error) {
      throw new A2AClientError(
        "TASK_GET_FAILED",
        `A2A tasks/get failed: [${body.error.code}] ${body.error.message}`,
      );
    }
    if (!body.result) {
      throw new A2AClientError("EMPTY_RESPONSE", "A2A tasks/get returned no result");
    }
    return body.result;
  }

  /**
   * Cancel a task on the remote A2A agent.
   */
  async cancelTask(taskId: string): Promise<Task> {
    const rpcRequest = {
      jsonrpc: "2.0" as const,
      id: taskId,
      method: "tasks/cancel",
      params: { id: taskId },
    };

    const response = await this.transport.fetch(`${this.baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rpcRequest),
    });

    const body = await response.json() as A2AJsonRpcResponse<Task>;
    if (body.error) {
      throw new A2AClientError(
        "TASK_CANCEL_FAILED",
        `A2A tasks/cancel failed: [${body.error.code}] ${body.error.message}`,
      );
    }
    if (!body.result) {
      throw new A2AClientError("EMPTY_RESPONSE", "A2A tasks/cancel returned no result");
    }
    return body.result;
  }
}

function extractTextFromTask(task: Task): string {
  if (task.status.message) {
    const textParts = task.status.message.parts.filter((p) => p.type === "text");
    if (textParts.length > 0) {
      return textParts.map((p) => p.text).join("\n");
    }
  }
  if (task.artifacts && task.artifacts.length > 0) {
    const texts: string[] = [];
    for (const artifact of task.artifacts) {
      for (const part of artifact.parts) {
        if (part.type === "text") texts.push(part.text);
      }
    }
    if (texts.length > 0) return texts.join("\n");
  }
  return "";
}

export class A2AClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "A2AClientError";
  }
}
