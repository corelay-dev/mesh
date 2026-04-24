import {
  Errors,
  PROTOCOL_VERSION,
  type CallToolParams,
  type CallToolResult,
  type InitializeResult,
  type JsonRpcError,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ListToolsResult,
  type McpServerInfo,
  type McpTool,
  type McpTransport,
} from "./types.js";

export interface McpServerConfig {
  info: McpServerInfo;
  tools: ReadonlyArray<McpTool>;
  transport: McpTransport;
}

/**
 * A minimal MCP server. Handles initialize, tools/list, tools/call over any
 * transport that moves JSON-RPC messages.
 *
 * Out of scope for v0.1: resources, prompts, sampling, OAuth, SSE, notifications
 * other than protocol-mandated ones. These can be added without breaking the
 * existing surface — or you can migrate to @modelcontextprotocol/sdk.
 */
export class McpServer {
  private readonly toolsByName: Map<string, McpTool>;

  constructor(private readonly config: McpServerConfig) {
    this.toolsByName = new Map(config.tools.map((t) => [t.name, t]));
  }

  start(): void {
    this.config.transport.read((msg) => {
      this.handle(msg).catch((err) => {
        // A handler failure must never kill the server — reply with an error.
        const id = isRequest(msg) ? (msg.id ?? null) : null;
        this.sendError(id, Errors.internal, errMsg(err));
      });
    });
  }

  stop(): void {
    this.config.transport.close?.();
  }

  private async handle(msg: JsonRpcMessage): Promise<void> {
    if (!isRequest(msg)) {
      // Responses from the client (to our requests) are out of scope for v0.1.
      // Notifications from the client are silently ignored.
      return;
    }

    const id = msg.id ?? null;

    switch (msg.method) {
      case "initialize":
        return this.sendResult<InitializeResult>(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: this.config.info,
          capabilities: { tools: {} },
        });

      case "initialized":
      case "notifications/initialized":
        // Acknowledge-only notification. Nothing to do.
        return;

      case "tools/list":
        return this.sendResult<ListToolsResult>(id, {
          tools: this.config.tools.map(({ handler: _h, ...t }) => t),
        });

      case "tools/call":
        return this.handleCall(id, msg.params as CallToolParams | undefined);

      case "ping":
        return this.sendResult(id, {});

      default:
        return this.sendError(id, Errors.methodNotFound, `Unknown method: ${msg.method}`);
    }
  }

  private async handleCall(
    id: string | number | null,
    params: CallToolParams | undefined,
  ): Promise<void> {
    if (!params || typeof params.name !== "string") {
      return this.sendError(id, Errors.invalidParams, "Missing tool name");
    }
    const tool = this.toolsByName.get(params.name);
    if (!tool) {
      return this.sendError(id, Errors.invalidParams, `Unknown tool: ${params.name}`);
    }

    try {
      const output = await tool.handler(params.arguments ?? {});
      const result: CallToolResult = {
        content: [{ type: "text", text: output }],
      };
      return this.sendResult(id, result);
    } catch (err) {
      // Tool-level errors surface as isError: true content, per MCP spec —
      // the tool call succeeded at the protocol layer, the tool's own
      // output indicates failure.
      const result: CallToolResult = {
        content: [{ type: "text", text: errMsg(err) }],
        isError: true,
      };
      return this.sendResult(id, result);
    }
  }

  private sendResult<R>(id: string | number | null, result: R): void {
    const msg: JsonRpcResponse<R> = { jsonrpc: "2.0", id, result };
    this.config.transport.write(msg);
  }

  private sendError(
    id: string | number | null,
    code: number,
    message: string,
  ): void {
    const msg: JsonRpcError = {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    };
    this.config.transport.write(msg);
  }
}

const isRequest = (msg: JsonRpcMessage): msg is JsonRpcRequest =>
  typeof (msg as JsonRpcRequest).method === "string";

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
