import type {
  CallToolResult,
  InitializeResult,
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  ListToolsResult,
  McpTransport,
} from "./types.js";
import { PROTOCOL_VERSION } from "./types.js";
import type { ToolDefinition } from "@corelay/mesh-core";

/** Configuration for creating an MCP client. */
export interface McpClientConfig {
  /** Transport to communicate with the remote MCP server. */
  transport: McpTransport;
  /** Client name sent in initialize. */
  clientInfo?: { name: string; version: string };
  /** Request timeout in ms. Default 30000. */
  timeoutMs?: number;
}

/** A discovered remote tool with its execute function. */
export interface RemoteTool {
  definition: ToolDefinition;
  call: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/**
 * MCP client — connects to an external MCP server over any McpTransport,
 * performs the handshake, discovers tools, and exposes them as Mesh-compatible
 * ToolDefinitions with call functions.
 */
export class McpClient {
  private readonly transport: McpTransport;
  private readonly clientInfo: { name: string; version: string };
  private readonly timeoutMs: number;
  private nextId = 1;
  private readonly pending = new Map<
    string | number,
    { resolve: (msg: JsonRpcResponse) => void; reject: (err: Error) => void }
  >();
  private serverInfo: InitializeResult | undefined;
  private listening = false;

  constructor(config: McpClientConfig) {
    this.transport = config.transport;
    this.clientInfo = config.clientInfo ?? { name: "mesh-mcp-client", version: "0.2.0" };
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  /**
   * Connect to the remote server: initialize + send notifications/initialized.
   * Must be called before listTools/callTool.
   */
  async connect(): Promise<InitializeResult> {
    this.startListening();

    const result = await this.request<InitializeResult>("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: this.clientInfo,
      capabilities: {},
    });

    this.serverInfo = result;

    // Send initialized notification (no id = notification)
    this.transport.write({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    } as JsonRpcRequest);

    return result;
  }

  /** List tools available on the remote server. */
  async listTools(): Promise<ListToolsResult> {
    return this.request<ListToolsResult>("tools/list", {});
  }

  /** Call a specific tool on the remote server. */
  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    return this.request<CallToolResult>("tools/call", { name, arguments: args ?? {} });
  }

  /**
   * Discover remote tools and wrap them as Mesh ToolDefinitions + call functions.
   * Convenience method that calls listTools and maps the results.
   */
  async discoverTools(): Promise<RemoteTool[]> {
    const { tools } = await this.listTools();
    return tools.map((t) => ({
      definition: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
      call: (args: Record<string, unknown>) => this.callTool(t.name, args),
    }));
  }

  /** Disconnect from the remote server. */
  close(): void {
    this.pending.forEach(({ reject }) => reject(new Error("Client closed")));
    this.pending.clear();
    this.transport.close?.();
    this.listening = false;
  }

  /** The server info returned during initialize, or undefined if not yet connected. */
  get server(): InitializeResult | undefined {
    return this.serverInfo;
  }

  private startListening(): void {
    if (this.listening) return;
    this.listening = true;

    this.transport.read((msg: JsonRpcMessage) => {
      if (isResponse(msg) || isError(msg)) {
        const id = msg.id;
        if (id == null) return;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);

        if (isError(msg)) {
          entry.reject(
            new McpClientError(msg.error.code, msg.error.message, msg.error.data),
          );
        } else {
          entry.resolve(msg as JsonRpcResponse);
        }
      }
      // Notifications from server are silently ignored for now.
    });
  }

  private request<R>(method: string, params: unknown): Promise<R> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    this.transport.write(msg);

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (resp) => {
          clearTimeout(timer);
          resolve(resp.result as R);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }
}

/** Error returned when the remote server responds with a JSON-RPC error. */
export class McpClientError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "McpClientError";
  }
}

const isResponse = (msg: JsonRpcMessage): msg is JsonRpcResponse =>
  "result" in msg;

const isError = (msg: JsonRpcMessage): msg is JsonRpcError =>
  "error" in msg;
