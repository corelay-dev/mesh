# @corelay/mesh-a2a

Agent-to-Agent (A2A) protocol adapter for [Corelay Mesh](https://github.com/corelay-dev/mesh).

Exposes Mesh agents as A2A-compliant HTTP endpoints and allows Mesh agents to delegate tasks to external A2A agents as if they were Mesh Peers.

## Features

- **A2A Server** — Wrap any Mesh agent as an A2A endpoint with agent card discovery and task management (send/get/cancel).
- **A2A Client** — Implements the Mesh `Peer` interface so remote A2A agents can be addressed just like local peers.
- **Zod schemas** — Full runtime validation of A2A protocol types (agent cards, tasks, messages, parts).
- **Transport-agnostic** — Bring your own HTTP framework via the `A2AHttpHandler` (server) and `A2AHttpTransport` (client) interfaces.

## Installation

```bash
npm install @corelay/mesh-a2a
```

## Usage

### Exposing a Mesh Agent as an A2A Server

```typescript
import { createA2AServer } from "@corelay/mesh-a2a";
import { PeerRegistry, Agent } from "@corelay/mesh-core";

const handler = createA2AServer({
  agentCard: {
    name: "My Agent",
    url: "http://localhost:3000",
    version: "1.0.0",
    skills: [{ id: "chat", name: "Chat" }],
  },
  registry,
  agentAddress: "tenant/my-agent",
  timeoutMs: 10_000,
});

// Wire into your HTTP framework:
// GET /.well-known/agent.json → agent card
// POST / → JSON-RPC (tasks/send, tasks/get, tasks/cancel)
```

### Delegating to a Remote A2A Agent

```typescript
import { A2AClient } from "@corelay/mesh-a2a";

const remoteAgent = new A2AClient({
  baseUrl: "http://remote-agent.example.com",
  transport: { fetch: globalThis.fetch.bind(globalThis) },
  address: "external/summarizer",
});

// Register as a Peer so local agents can send messages to it
registry.register(remoteAgent);
remoteAgent.setReplyHandler((msg) => registry.deliver(msg));
```

## API

### `createA2AServer(config: A2AServerConfig): A2AHttpHandler`

Creates a request handler implementing the A2A protocol. Routes:
- `GET /.well-known/agent.json` — returns the agent card
- `POST /` — JSON-RPC 2.0 endpoint for `tasks/send`, `tasks/get`, `tasks/cancel`

### `A2AClient`

Implements the Mesh `Peer` interface. When a message is sent to this peer, it translates to an A2A `tasks/send` call. Also exposes `getAgentCard()`, `getTask(id)`, and `cancelTask(id)`.

## Protocol Compliance

Implements the core A2A specification:
- Agent card discovery via `/.well-known/agent.json`
- Task lifecycle: submit → working → completed/failed/canceled
- JSON-RPC 2.0 transport with standard error codes
- Text, file, and data parts in messages

Not yet implemented: streaming, push notifications, server-sent events.

## Caveats

### In-Memory Task Store

The server stores all tasks in an unbounded in-memory `Map`. This is suitable for development and low-throughput deployments but **will leak memory** under sustained load since completed/failed tasks are never evicted.

<!-- TODO: Add TTL-based eviction (e.g. remove tasks older than N minutes) or a configurable
     maxTasks cap with LRU eviction. Track in https://github.com/corelay-dev/mesh/issues -->

For production use, consider:
- Providing a pluggable `TaskStore` interface backed by Redis/Postgres
- Adding a TTL sweep that prunes completed tasks after a configurable retention period
- Setting a max task count with LRU eviction for memory-constrained environments

## License

MIT
