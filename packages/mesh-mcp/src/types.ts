/**
 * Minimal MCP protocol types for the server-side scope Corelay Mesh needs.
 *
 * We implement only what an MCP client (Claude Desktop, Cursor, ChatGPT) asks
 * for when calling tools. Resources, prompts, sampling, OAuth — out of scope
 * for v0.1; migrating to the official @modelcontextprotocol/sdk later is easy
 * because these types mirror theirs exactly.
 */

export const PROTOCOL_VERSION = "2025-03-26";

/** JSON-RPC 2.0 request. */
export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: P;
}

/** JSON-RPC 2.0 response (success). */
export interface JsonRpcResponse<R = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: R;
}

/** JSON-RPC 2.0 response (error). */
export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcError;

/** initialize result. */
export interface InitializeResult {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: {
    tools?: Record<string, unknown>;
  };
}

/** tools/list result. */
export interface ListToolsResult {
  tools: ReadonlyArray<{
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required?: ReadonlyArray<string>;
    };
  }>;
}

/** tools/call params. */
export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/** tools/call result. */
export interface CallToolResult {
  content: ReadonlyArray<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

/** A tool the server exposes. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: ReadonlyArray<string>;
  };
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/** Server info. */
export interface McpServerInfo {
  name: string;
  version: string;
}

/** A transport — stdio in practice, abstracted here so tests can inject. */
export interface McpTransport {
  read(onMessage: (msg: JsonRpcMessage) => void): void;
  write(msg: JsonRpcMessage): void;
  close?(): void;
}

/** Error codes per JSON-RPC 2.0. */
export const Errors = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;
