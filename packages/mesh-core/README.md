# @corelay/mesh-core

Foundation package for [Corelay Mesh](https://github.com/corelay-dev/mesh) — agents, peers, messaging, capabilities, and workflows. Every other `@corelay/*` package depends on this.

## Install

```bash
npm install @corelay/mesh-core
```

ESM-only. Requires Node 20+.

## Quick Start

```ts
import { Agent, MemoryInbox, PeerRegistry, run } from "@corelay/mesh-core";
import type { Address, AgentConfig, LLMClient } from "@corelay/mesh-core";

const registry = new PeerRegistry();
const address = "agent/greeter" as Address;

const config: AgentConfig = {
  name: "greeter",
  description: "Greets the user",
  prompt: "You are a friendly greeter.",
  model: "gpt-4o-mini",
  maxResponseTokens: 256,
  welcomeMessage: "Hello!",
  guardrails: "",
  tools: [],
  capabilities: [{ kind: "peer", address: "ephemeral/*" as Address }],
};

const agent = new Agent(address, config, llm, new MemoryInbox(), registry);
registry.register(agent);
await agent.start();

const { content, traceId } = await run(registry, address, "Hi there!");
```

## Exports

| Export | Kind |
| --- | --- |
| `Agent`, `AgentConfig`, `AgentOptions` | Core agent class & config |
| `CapabilityError` | Thrown on unauthorised peer sends |
| `Peer`, `PeerRegistry`, `UnknownPeerError` | Peer primitives & registry |
| `MemoryInbox`, `Inbox`, `MessageHandler` | Inbox implementations |
| `Capability`, `PeerCapability`, `ToolCapability`, `ChannelCapability` | Capability grants |
| `Address`, `parseAddress` | Typed address & parser |
| `Message`, `MessageKind` | Message envelope |
| `LLMClient`, `LLMMessage`, `LLMRequest`, `LLMResponse`, `TokenUsage` | LLM abstraction |
| `ToolDefinition`, `ToolCall`, `ToolResult` | Tool types |
| `Workflow`, `WorkflowEvent`, `WorkflowStatus`, `WorkflowEventKind` | Workflow types |
| `WorkflowRecorder` | Durable workflow recording |
| `run`, `RunOptions`, `RunResult` | Convenience send-and-await helper |

## License

MIT — Corelay Ltd
