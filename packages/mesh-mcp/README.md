# @corelay/mesh-mcp

Minimal [Model Context Protocol](https://modelcontextprotocol.io/) server for [Corelay Mesh](https://github.com/corelay-dev/mesh) — expose any Mesh agent as an MCP tool over stdio.

Implements MCP spec **2025-03-26**. Handles `initialize`, `tools/list`, `tools/call`, and `ping` over JSON-RPC 2.0. Zero external dependencies beyond `@corelay/mesh-core`.

## Install

```bash
npm install @corelay/mesh-mcp
```

## Usage

```ts
import { McpServer, stdioTransport, mcpToolFromAgent } from "@corelay/mesh-mcp";
import { createRegistry } from "@corelay/mesh-core";

const registry = createRegistry();

const tool = mcpToolFromAgent({
  name: "ask-support-agent",
  description: "Ask the support agent a question.",
  registry,
  agentAddress: "agent://support",
  timeoutMs: 15_000,
});

const server = new McpServer({
  info: { name: "my-mesh-server", version: "1.0.0" },
  tools: [tool],
  transport: stdioTransport(),
});

server.start();
```

## API

| Export | Description |
| --- | --- |
| `McpServer` | JSON-RPC server — wire up tools and a transport, call `start()`. |
| `stdioTransport()` | Stdio transport (newline-delimited JSON on stdin/stdout). |
| `mcpToolFromAgent(config)` | Wraps a Mesh agent as an `McpTool`. Config: `name`, `description`, `registry`, `agentAddress`, optional `callerAddress`, `timeoutMs` (default 30 s), `argumentName` (default `"message"`). |
| `PROTOCOL_VERSION` | `"2025-03-26"` |
| `Errors` | Standard JSON-RPC error codes. |

Tool errors surface as `isError` content per MCP spec — the protocol call succeeds, the tool output indicates failure.

## Client config

```json
{
  "mcpServers": {
    "my-mesh-server": { "command": "node", "args": ["./server.js"] }
  }
}
```

## License

MIT — [Corelay Ltd](https://github.com/corelay-dev/mesh).