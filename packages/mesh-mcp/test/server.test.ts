import { describe, it, expect } from "vitest";
import {
  McpServer,
  PROTOCOL_VERSION,
  Errors,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcError,
  type McpTool,
  type McpTransport,
  type InitializeResult,
  type ListToolsResult,
  type CallToolResult,
} from "../src/index.js";

/** In-memory transport: a buffer of outbound messages + a send-in method. */
const makeTransport = () => {
  const outbox: JsonRpcMessage[] = [];
  let handler: ((msg: JsonRpcMessage) => void) | undefined;
  const transport: McpTransport = {
    read(onMessage) {
      handler = onMessage;
    },
    write(msg) {
      outbox.push(msg);
    },
    close() {
      handler = undefined;
    },
  };
  const sendIn = async (msg: JsonRpcMessage) => {
    handler?.(msg);
    // Give the handler a microtask to finish
    await Promise.resolve();
    await Promise.resolve();
  };
  return { transport, outbox, sendIn };
};

const echoTool: McpTool = {
  name: "echo",
  description: "Echoes the input back.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  handler: async (args) => String(args.text ?? ""),
};

const throwingTool: McpTool = {
  name: "explode",
  description: "Always fails.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    throw new Error("nope");
  },
};

describe("McpServer — initialize + discovery", () => {
  it("responds to initialize with protocol version and server info", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "test", version: "0.0.1" },
      tools: [echoTool],
      transport,
    });
    server.start();

    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    };
    await sendIn(req);

    const response = outbox[0] as JsonRpcResponse<InitializeResult>;
    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(response.result.serverInfo).toEqual({ name: "test", version: "0.0.1" });
    expect(response.result.capabilities.tools).toBeDefined();
  });

  it("responds to tools/list without leaking handlers", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "test", version: "0.0.1" },
      tools: [echoTool],
      transport,
    });
    server.start();

    await sendIn({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const response = outbox[0] as JsonRpcResponse<ListToolsResult>;
    expect(response.result.tools).toHaveLength(1);
    expect(response.result.tools[0]?.name).toBe("echo");
    // The handler function must not be serialised
    expect((response.result.tools[0] as unknown as { handler?: unknown }).handler).toBeUndefined();
  });

  it("replies to ping with an empty object", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "t", version: "0" },
      tools: [],
      transport,
    });
    server.start();

    await sendIn({ jsonrpc: "2.0", id: 9, method: "ping" });
    const response = outbox[0] as JsonRpcResponse;
    expect(response.id).toBe(9);
    expect(response.result).toEqual({});
  });

  it("silently ignores notifications (notifications/initialized)", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "t", version: "0" },
      tools: [],
      transport,
    });
    server.start();

    await sendIn({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(outbox).toHaveLength(0);
  });

  it("returns methodNotFound for unknown methods", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "t", version: "0" },
      tools: [],
      transport,
    });
    server.start();

    await sendIn({ jsonrpc: "2.0", id: 3, method: "nonsense" });
    const response = outbox[0] as JsonRpcError;
    expect(response.error.code).toBe(Errors.methodNotFound);
    expect(response.error.message).toContain("nonsense");
  });
});

describe("McpServer — tools/call", () => {
  it("invokes the tool and returns text content", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "t", version: "0" },
      tools: [echoTool],
      transport,
    });
    server.start();

    await sendIn({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } },
    });

    const response = outbox[0] as JsonRpcResponse<CallToolResult>;
    expect(response.result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(response.result.isError).toBeUndefined();
  });

  it("returns invalidParams when the tool name is missing", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "t", version: "0" },
      tools: [echoTool],
      transport,
    });
    server.start();

    await sendIn({ jsonrpc: "2.0", id: 11, method: "tools/call", params: {} });
    const response = outbox[0] as JsonRpcError;
    expect(response.error.code).toBe(Errors.invalidParams);
  });

  it("returns invalidParams when the tool is unknown", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "t", version: "0" },
      tools: [echoTool],
      transport,
    });
    server.start();

    await sendIn({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "missing" },
    });
    const response = outbox[0] as JsonRpcError;
    expect(response.error.code).toBe(Errors.invalidParams);
    expect(response.error.message).toContain("missing");
  });

  it("surfaces tool errors as isError content, not as JSON-RPC errors", async () => {
    const { transport, outbox, sendIn } = makeTransport();
    const server = new McpServer({
      info: { name: "t", version: "0" },
      tools: [throwingTool],
      transport,
    });
    server.start();

    await sendIn({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "explode" },
    });

    const response = outbox[0] as JsonRpcResponse<CallToolResult>;
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]?.text).toContain("nope");
  });
});
