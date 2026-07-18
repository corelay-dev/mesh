import { run, type Address, type PeerRegistry } from "@corelay/mesh-core";
import type {
  AgentCard,
  Task,
  TaskSendParams,
  TaskQueryParams,
  TaskCancelParams,
  A2AJsonRpcRequest,
  A2AJsonRpcResponse,
  A2AError,
} from "./schemas.js";
import {
  TaskSendParamsSchema,
  TaskQueryParamsSchema,
  TaskCancelParamsSchema,
  JsonRpcRequestSchema,
  A2A_ERROR_CODES,
} from "./schemas.js";

export interface A2AServerConfig {
  /** The agent card describing this agent's A2A identity. */
  agentCard: AgentCard;
  /** PeerRegistry hosting the agent. */
  registry: PeerRegistry;
  /** Address of the Mesh agent to route tasks to. */
  agentAddress: Address;
  /** Fixed caller address for routing replies back. */
  callerAddress?: Address;
  /** Timeout for task execution, ms. Default 30000. */
  timeoutMs?: number;
}

/**
 * An HTTP transport abstraction so tests can inject a mock and we don't
 * couple to any specific HTTP framework.
 */
export interface A2AHttpHandler {
  (request: A2AHttpRequest): Promise<A2AHttpResponse>;
}

export interface A2AHttpRequest {
  method: string;
  path: string;
  body: unknown;
  headers?: Record<string, string>;
}

export interface A2AHttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Create an A2A-compliant server that wraps a Mesh agent.
 *
 * The server exposes:
 * - GET /.well-known/agent.json → agent card
 * - POST / → JSON-RPC methods: tasks/send, tasks/get, tasks/cancel
 *
 * Tasks are processed synchronously (no streaming in v0.1). The agent is
 * invoked via mesh-core `run()` and the reply maps to a completed task.
 */
export const createA2AServer = (config: A2AServerConfig): A2AHttpHandler => {
  // TODO: Unbounded — add TTL eviction or max-size cap for production use
  const tasks = new Map<string, Task>();
  const timeoutMs = config.timeoutMs ?? 30_000;

  const handleAgentCard = (): A2AHttpResponse => ({
    status: 200,
    body: config.agentCard,
    headers: { "content-type": "application/json" },
  });

  const handleTaskSend = async (params: TaskSendParams): Promise<Task> => {
    const textParts = params.message.parts.filter((p) => p.type === "text");
    const userMessage = textParts.map((p) => p.text).join("\n");

    const task: Task = {
      id: params.id,
      sessionId: params.sessionId,
      status: { state: "working", timestamp: new Date().toISOString() },
      history: [params.message],
      metadata: params.metadata,
    };
    tasks.set(params.id, task);

    try {
      const result = await run(config.registry, config.agentAddress, userMessage, {
        timeoutMs,
        ...(config.callerAddress && { from: config.callerAddress }),
      });

      task.status = {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: result.content }],
        },
        timestamp: new Date().toISOString(),
      };
      task.artifacts = [{
        parts: [{ type: "text", text: result.content }],
        index: 0,
        lastChunk: true,
      }];
    } catch (err) {
      task.status = {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: err instanceof Error ? err.message : "Unknown error" }],
        },
        timestamp: new Date().toISOString(),
      };
    }

    tasks.set(params.id, task);
    return task;
  };

  const handleTaskGet = (params: TaskQueryParams): Task | A2AError => {
    const task = tasks.get(params.id);
    if (!task) {
      return { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: `Task not found: ${params.id}` };
    }
    return task;
  };

  const handleTaskCancel = (params: TaskCancelParams): Task | A2AError => {
    const task = tasks.get(params.id);
    if (!task) {
      return { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: `Task not found: ${params.id}` };
    }
    if (task.status.state === "completed" || task.status.state === "failed") {
      return { code: A2A_ERROR_CODES.TASK_NOT_CANCELABLE, message: `Task ${params.id} is already ${task.status.state}` };
    }
    task.status = { state: "canceled", timestamp: new Date().toISOString() };
    tasks.set(params.id, task);
    return task;
  };

  const makeResponse = <T>(id: string | number, result: T): A2AJsonRpcResponse<T> => ({
    jsonrpc: "2.0",
    id,
    result,
  });

  const makeErrorResponse = (id: string | number, error: A2AError): A2AJsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    error,
  });

  const handleJsonRpc = async (body: unknown): Promise<A2AHttpResponse> => {
    const parsed = JsonRpcRequestSchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: makeErrorResponse(0, {
          code: A2A_ERROR_CODES.INVALID_REQUEST,
          message: "Invalid JSON-RPC request",
          data: parsed.error.issues,
        }),
      };
    }

    const request: A2AJsonRpcRequest = parsed.data;

    switch (request.method) {
      case "tasks/send": {
        const paramsResult = TaskSendParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return {
            status: 400,
            body: makeErrorResponse(request.id, {
              code: A2A_ERROR_CODES.INVALID_PARAMS,
              message: "Invalid task send params",
              data: paramsResult.error.issues,
            }),
          };
        }
        const task = await handleTaskSend(paramsResult.data);
        return { status: 200, body: makeResponse(request.id, task) };
      }
      case "tasks/get": {
        const paramsResult = TaskQueryParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return {
            status: 400,
            body: makeErrorResponse(request.id, {
              code: A2A_ERROR_CODES.INVALID_PARAMS,
              message: "Invalid task query params",
              data: paramsResult.error.issues,
            }),
          };
        }
        const result = handleTaskGet(paramsResult.data);
        if ("code" in result) {
          return { status: 404, body: makeErrorResponse(request.id, result) };
        }
        return { status: 200, body: makeResponse(request.id, result) };
      }
      case "tasks/cancel": {
        const paramsResult = TaskCancelParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return {
            status: 400,
            body: makeErrorResponse(request.id, {
              code: A2A_ERROR_CODES.INVALID_PARAMS,
              message: "Invalid task cancel params",
              data: paramsResult.error.issues,
            }),
          };
        }
        const result = handleTaskCancel(paramsResult.data);
        if ("code" in result) {
          const status = result.code === A2A_ERROR_CODES.TASK_NOT_FOUND ? 404 : 409;
          return { status, body: makeErrorResponse(request.id, result) };
        }
        return { status: 200, body: makeResponse(request.id, result) };
      }
      default:
        return {
          status: 404,
          body: makeErrorResponse(request.id, {
            code: A2A_ERROR_CODES.METHOD_NOT_FOUND,
            message: `Unknown method: ${request.method}`,
          }),
        };
    }
  };

  return async (request: A2AHttpRequest): Promise<A2AHttpResponse> => {
    if (request.method === "GET" && request.path === "/.well-known/agent.json") {
      return handleAgentCard();
    }
    if (request.method === "POST" && request.path === "/") {
      return handleJsonRpc(request.body);
    }
    return { status: 404, body: { error: "Not found" } };
  };
};
