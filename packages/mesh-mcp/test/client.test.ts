import { describe, it, expect, afterEach } from "vitest";
import {
  McpClient,
  McpClientError,
  McpServer,
  PROTOCOL_VERSION,
  type JsonRpcMessage,
  type McpTool,
  type McpTransport,
} from "../src/index.js";

/**
 * Loopback transport pair: messages written by one side are read by the other.
 * This lets us wire a client to a server entirely in-process with no subprocess or network.
 */
const makeLoopback = (): { clientTransport: McpTransport; serverTransport: McpTransport } => {
  let clientHandler: ((msg: JsonRpcMessage) => void) | undefined;
  let serverHandler: ((msg: JsonRpcMessage) => void) | undefined;

  const clientTransport: McpTransport = {
    read(onMessage) {
      clientHandler = onMessage;
    },
    write(msg) {
      // Client writes go to the server's read handler (async to simulate real transport)
      queueMicrotask(() => serverHandler?.(msg));
    },
    close() {
      clientHandler = undefined;
    },
  };

  const serverTransport: McpTransport = {
    read(onMessage) {
      serverHandler = onMessage;
    },
    write(msg) {
      // Server writes go to the client's read handler
      queueMicrotask(() => clientHandler?.(msg));
    },
    close() {
      serverHandler = undefined;
    },
  };

  return { clientTransport, serverTransport };
};

const echoTool: McpTool = {
  name: "echo",
  description: "Echoes the input back.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "Text to echo" } },
    required: ["text"],
  },
  handler: async (args) => String(args.text ?? ""),
};

const addTool: McpTool = {
  name: "add",
  description: "Adds two numbers.",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" },
    },
    required: ["a", "b"],
  },
  handler: async (args) => String(Number(args.a) + Number(args.b)),
};

const failTool: McpTool = {
  name: "fail",
  description: "Always throws.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    throw new Error("deliberate failure");
  },
};

const makeClientServer = (tools: McpTool[] = [echoTool, addTool, failTool]) => {
  const { clientTransport, serverTransport } = makeLoopback();

  const server = new McpServer({
    info: { name: "test-server", version: "1.0.0" },
    tools,
    transport: serverTransport,
  });
  server.start();

  const client = new McpClient({
    transport: clientTransport,
    clientInfo: { name: "test-client", version: "0.1.0" },
    timeoutMs: 5_000,
  });

  return { client, server };
};

describe("McpClient — connect (initialize handshake)", () => {
  let client: McpClient | undefined;
  let server: McpServer | undefined;

  afterEach(() => {
    client?.close();
    server?.stop();
  });

  it("performs initialize and receives server info with correct protocol version", async () => {
    ({ client, server } = makeClientServer());
    const result = await client.connect();

    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.serverInfo).toEqual({ name: "test-server", version: "1.0.0" });
    expect(result.capabilities.tools).toBeDefined();
  });

  it("exposes server info via .server after connect", async () => {
    ({ client, server } = makeClientServer());
    expect(client.server).toBeUndefined();
    await client.connect();
    expect(client.server?.serverInfo.name).toBe("test-server");
  });
});

describe("McpClient — tools/list", () => {
  let client: McpClient | undefined;
  let server: McpServer | undefined;

  afterEach(() => {
    client?.close();
    server?.stop();
  });

  it("lists all tools exposed by the remote server", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();
    const result = await client.listTools();

    expect(result.tools).toHaveLength(3);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("echo");
    expect(names).toContain("add");
    expect(names).toContain("fail");
  });

  it("returns tool schemas without handler functions", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();
    const result = await client.listTools();

    const echo = result.tools.find((t) => t.name === "echo");
    expect(echo?.inputSchema.properties).toHaveProperty("text");
    expect((echo as unknown as { handler?: unknown }).handler).toBeUndefined();
  });
});

describe("McpClient — tools/call", () => {
  let client: McpClient | undefined;
  let server: McpServer | undefined;

  afterEach(() => {
    client?.close();
    server?.stop();
  });

  it("calls a tool and returns text content", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();
    const result = await client.callTool("echo", { text: "hello world" });

    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
    expect(result.isError).toBeUndefined();
  });

  it("calls a tool with numeric args and gets computed result", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();
    const result = await client.callTool("add", { a: 3, b: 7 });

    expect(result.content[0]?.text).toBe("10");
  });

  it("returns isError: true when the remote tool throws", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();
    const result = await client.callTool("fail", {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("deliberate failure");
  });

  it("throws McpClientError when calling an unknown tool", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();

    // Server returns invalidParams for unknown tools
    await expect(client.callTool("nonexistent", {})).rejects.toThrow(McpClientError);
  });
});

describe("McpClient — discoverTools (Mesh integration)", () => {
  let client: McpClient | undefined;
  let server: McpServer | undefined;

  afterEach(() => {
    client?.close();
    server?.stop();
  });

  it("wraps remote tools as Mesh ToolDefinitions with correct schema", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();
    const tools = await client.discoverTools();

    expect(tools).toHaveLength(3);
    const echo = tools.find((t) => t.definition.name === "echo");
    expect(echo).toBeDefined();
    expect(echo!.definition.description).toBe("Echoes the input back.");
    expect(echo!.definition.parameters).toEqual({
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"],
    });
  });

  it("provides callable functions that invoke the remote tool", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();
    const tools = await client.discoverTools();

    const add = tools.find((t) => t.definition.name === "add")!;
    const result = await add.call({ a: 5, b: 3 });
    expect(result.content[0]?.text).toBe("8");
  });

  it("discovered tool call functions propagate remote errors", async () => {
    ({ client, server } = makeClientServer());
    await client.connect();
    const tools = await client.discoverTools();

    const fail = tools.find((t) => t.definition.name === "fail")!;
    const result = await fail.call({});
    expect(result.isError).toBe(true);
  });
});

describe("McpClient — error handling", () => {
  let client: McpClient | undefined;
  let server: McpServer | undefined;

  afterEach(() => {
    client?.close();
    server?.stop();
  });

  it("rejects pending requests on close", async () => {
    const { clientTransport, serverTransport: _st } = makeLoopback();
    // Don't start a server — requests will hang
    client = new McpClient({ transport: clientTransport, timeoutMs: 5_000 });

    // Start listening so the client can send
    clientTransport.read(() => {});

    const promise = client.connect();
    client.close();

    await expect(promise).rejects.toThrow("Client closed");
  });

  it("times out if the server does not respond", async () => {
    const { clientTransport, serverTransport: _st } = makeLoopback();
    // No server to respond
    client = new McpClient({ transport: clientTransport, timeoutMs: 50 });

    await expect(client.connect()).rejects.toThrow("timed out");
  });
});
