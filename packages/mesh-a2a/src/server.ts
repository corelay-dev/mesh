import { run, type Address, type PeerRegistry } from "@corelay/mesh-core";
import type {
  AgentCard,
  Task,
  TaskSendParams,
  TaskSendSubscribeParams,
  TaskResubscribeParams,
  TaskQueryParams,
  TaskCancelParams,
  A2AJsonRpcRequest,
  A2AJsonRpcResponse,
  A2AError,
  TaskStreamingEvent,
  PushNotificationConfig,
} from "./schemas.js";
import {
  TaskSendParamsSchema,
  TaskSendSubscribeParamsSchema,
  TaskResubscribeParamsSchema,
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
  /**
   * HTTP client for delivering push notifications.
   * If not provided, push notifications are silently skipped.
   */
  pushNotificationTransport?: PushNotificationTransport;
}

/**
 * Transport abstraction for delivering push notifications to webhooks.
 */
export interface PushNotificationTransport {
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number }>;
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
 * Streaming SSE response — the body is an AsyncIterable of SSE-formatted strings.
 */
export interface A2ASseResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<string>;
}

/**
 * Extended handler that can return either a standard response or an SSE stream.
 */
export interface A2AExtendedHttpHandler {
  (request: A2AHttpRequest): Promise<A2AHttpResponse | A2ASseResponse>;
}

/** Type guard: is the response an SSE stream? */
export const isSseResponse = (r: A2AHttpResponse | A2ASseResponse): r is A2ASseResponse =>
  r.headers?.["content-type"] === "text/event-stream" &&
  Symbol.asyncIterator in (r.body as object);

/**
 * Subscriber for a task — receives streaming events.
 */
interface TaskSubscriber {
  emit(event: TaskStreamingEvent): void;
  close(): void;
}

/**
 * Create an A2A-compliant server that wraps a Mesh agent.
 *
 * The server exposes:
 * - GET /.well-known/agent.json → agent card
 * - POST / → JSON-RPC methods: tasks/send, tasks/get, tasks/cancel,
 *   tasks/sendSubscribe, tasks/resubscribe
 *
 * Streaming methods return an A2ASseResponse with an AsyncIterable body.
 * Push notifications are delivered to the configured webhook URL.
 */
export const createA2AServer = (config: A2AServerConfig): A2AExtendedHttpHandler => {
  // TODO: Unbounded — add TTL eviction or max-size cap for production use
  const tasks = new Map<string, Task>();
  const taskSubscribers = new Map<string, Set<TaskSubscriber>>();
  const taskPushConfigs = new Map<string, PushNotificationConfig>();
  const timeoutMs = config.timeoutMs ?? 30_000;

  const handleAgentCard = (): A2AHttpResponse => ({
    status: 200,
    body: config.agentCard,
    headers: { "content-type": "application/json" },
  });

  const emitToSubscribers = (taskId: string, event: TaskStreamingEvent): void => {
    const subs = taskSubscribers.get(taskId);
    if (subs) {
      for (const sub of subs) {
        sub.emit(event);
      }
    }
  };

  const deliverPushNotification = async (taskId: string, event: TaskStreamingEvent): Promise<void> => {
    const pushConfig = taskPushConfigs.get(taskId);
    if (!pushConfig || !config.pushNotificationTransport) return;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (pushConfig.token) {
      headers["authorization"] = `Bearer ${pushConfig.token}`;
    }

    try {
      await config.pushNotificationTransport.post(pushConfig.url, event, headers);
    } catch {
      // Push notification delivery is best-effort — log failure but don't crash
    }
  };

  const notifyEvent = (taskId: string, event: TaskStreamingEvent): void => {
    emitToSubscribers(taskId, event);
    void deliverPushNotification(taskId, event);
  };

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

    // Store push config if provided
    if (params.pushNotification) {
      taskPushConfigs.set(params.id, params.pushNotification);
    }

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

    // Notify subscribers/push about final state
    notifyEvent(params.id, { type: "status", taskId: params.id, status: task.status, final: true });
    if (task.artifacts) {
      for (const artifact of task.artifacts) {
        notifyEvent(params.id, { type: "artifact", taskId: params.id, artifact });
      }
    }

    return task;
  };

  const handleTaskSendSubscribe = (params: TaskSendSubscribeParams): A2ASseResponse => {
    // Store push config if provided
    if (params.pushNotification) {
      taskPushConfigs.set(params.id, params.pushNotification);
    }

    const eventQueue: TaskStreamingEvent[] = [];
    let resolve: (() => void) | undefined;
    let closed = false;

    const subscriber: TaskSubscriber = {
      emit(event: TaskStreamingEvent) {
        eventQueue.push(event);
        resolve?.();
      },
      close() {
        closed = true;
        resolve?.();
      },
    };

    // Register subscriber before starting execution
    if (!taskSubscribers.has(params.id)) {
      taskSubscribers.set(params.id, new Set());
    }
    taskSubscribers.get(params.id)!.add(subscriber);

    // Start task execution asynchronously
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

    // Emit initial working status
    const workingEvent: TaskStreamingEvent = {
      type: "status",
      taskId: params.id,
      status: task.status,
      final: false,
    };
    subscriber.emit(workingEvent);
    // Also deliver to push (excluding the streaming subscriber's own delivery)
    void deliverPushNotification(params.id, workingEvent);

    // Execute the task in the background
    void (async () => {
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

      // Emit artifact events
      if (task.artifacts) {
        for (const artifact of task.artifacts) {
          notifyEvent(params.id, { type: "artifact", taskId: params.id, artifact });
        }
      }

      // Emit final status
      notifyEvent(params.id, { type: "status", taskId: params.id, status: task.status, final: true });

      // Close and clean up this subscriber
      subscriber.close();
      taskSubscribers.get(params.id)?.delete(subscriber);
    })();

    const body: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<string>> {
            while (true) {
              if (eventQueue.length > 0) {
                const event = eventQueue.shift()!;
                const sseData = `data: ${JSON.stringify(event)}\n\n`;
                if (event.type === "status" && event.final) {
                  return { value: sseData, done: false };
                }
                return { value: sseData, done: false };
              }
              if (closed && eventQueue.length === 0) {
                return { value: undefined as unknown as string, done: true };
              }
              await new Promise<void>((r) => { resolve = r; });
            }
          },
        };
      },
    };

    return {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
      body,
    };
  };

  const handleTaskResubscribe = (params: TaskResubscribeParams): A2ASseResponse | A2AHttpResponse => {
    const task = tasks.get(params.id);
    if (!task) {
      return {
        status: 404,
        body: makeErrorResponse(0, {
          code: A2A_ERROR_CODES.TASK_NOT_FOUND,
          message: `Task not found: ${params.id}`,
        }),
      };
    }

    // If the task is already in a terminal state, return a single-event stream
    const isTerminal = task.status.state === "completed" ||
      task.status.state === "failed" ||
      task.status.state === "canceled";

    if (isTerminal) {
      const events: TaskStreamingEvent[] = [];
      if (task.artifacts) {
        for (const artifact of task.artifacts) {
          events.push({ type: "artifact", taskId: params.id, artifact });
        }
      }
      events.push({ type: "status", taskId: params.id, status: task.status, final: true });

      const body: AsyncIterable<string> = {
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
      };

      return {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        },
        body,
      };
    }

    // Task is still in progress — subscribe for future events
    const eventQueue: TaskStreamingEvent[] = [];
    let resolve: (() => void) | undefined;
    let closed = false;

    const subscriber: TaskSubscriber = {
      emit(event: TaskStreamingEvent) {
        eventQueue.push(event);
        resolve?.();
      },
      close() {
        closed = true;
        resolve?.();
      },
    };

    if (!taskSubscribers.has(params.id)) {
      taskSubscribers.set(params.id, new Set());
    }
    taskSubscribers.get(params.id)!.add(subscriber);

    // Emit current status as first event
    subscriber.emit({ type: "status", taskId: params.id, status: task.status, final: false });

    const body: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<string>> {
            while (true) {
              if (eventQueue.length > 0) {
                const event = eventQueue.shift()!;
                const sseData = `data: ${JSON.stringify(event)}\n\n`;
                // If final, mark stream as done after this event
                if (event.type === "status" && event.final) {
                  taskSubscribers.get(params.id)?.delete(subscriber);
                  return { value: sseData, done: false };
                }
                return { value: sseData, done: false };
              }
              if (closed && eventQueue.length === 0) {
                return { value: undefined as unknown as string, done: true };
              }
              await new Promise<void>((r) => { resolve = r; });
            }
          },
        };
      },
    };

    return {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
      body,
    };
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

    // Notify subscribers about cancellation
    notifyEvent(params.id, { type: "status", taskId: params.id, status: task.status, final: true });

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

  const handleJsonRpc = async (body: unknown): Promise<A2AHttpResponse | A2ASseResponse> => {
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
      case "tasks/sendSubscribe": {
        const paramsResult = TaskSendSubscribeParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return {
            status: 400,
            body: makeErrorResponse(request.id, {
              code: A2A_ERROR_CODES.INVALID_PARAMS,
              message: "Invalid task sendSubscribe params",
              data: paramsResult.error.issues,
            }),
          };
        }
        return handleTaskSendSubscribe(paramsResult.data);
      }
      case "tasks/resubscribe": {
        const paramsResult = TaskResubscribeParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return {
            status: 400,
            body: makeErrorResponse(request.id, {
              code: A2A_ERROR_CODES.INVALID_PARAMS,
              message: "Invalid task resubscribe params",
              data: paramsResult.error.issues,
            }),
          };
        }
        return handleTaskResubscribe(paramsResult.data);
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

  return async (request: A2AHttpRequest): Promise<A2AHttpResponse | A2ASseResponse> => {
    if (request.method === "GET" && request.path === "/.well-known/agent.json") {
      return handleAgentCard();
    }
    if (request.method === "POST" && request.path === "/") {
      return handleJsonRpc(request.body);
    }
    return { status: 404, body: { error: "Not found" } };
  };
};
