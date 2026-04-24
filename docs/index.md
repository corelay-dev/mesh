# Corelay Mesh — Documentation

> [corelay-dev/mesh](https://github.com/corelay-dev/mesh) · [Architecture essay](https://corelay.dev/architecture) · [Agent-Factory thesis](https://corelay.dev/agent-factory)

## Packages

| Package | Description | README |
|---|---|---|
| [@corelay/mesh-core](../packages/mesh-core/) | Agent, Peer, Inbox, Capability, Workflow, PeerRegistry, run() | [README](../packages/mesh-core/README.md) |
| [@corelay/mesh-postgres](../packages/mesh-postgres/) | Durable WorkflowStore, PostgresInbox, sweepStaleWorkflows | [README](../packages/mesh-postgres/README.md) |
| [@corelay/mesh-llm](../packages/mesh-llm/) | LLMRouter + OpenAI, Anthropic, Bedrock clients | [README](../packages/mesh-llm/README.md) |
| [@corelay/mesh-coordination](../packages/mesh-coordination/) | Critic, Debate, Hierarchy, HumanPeer | [README](../packages/mesh-coordination/README.md) |
| [@corelay/mesh-channels-whatsapp](../packages/mesh-channels-whatsapp/) | WhatsApp Cloud API channel adapter | [README](../packages/mesh-channels-whatsapp/README.md) |
| [@corelay/mesh-observe](../packages/mesh-observe/) | Tracer interface + OpenTelemetry implementation | [README](../packages/mesh-observe/README.md) |
| [@corelay/mesh-compose](../packages/mesh-compose/) | Authoring agent — compose(), approve(), reject(), createCriticAuthor() | [README](../packages/mesh-compose/README.md) |
| [@corelay/mesh-eval](../packages/mesh-eval/) | Eval suites, LLM-judged scoring, deploy-gate thresholds, regression comparison | [README](../packages/mesh-eval/README.md) |
| [@corelay/mesh-mcp](../packages/mesh-mcp/) | MCP server — expose agents as tools for Claude Desktop / Cursor / ChatGPT | [README](../packages/mesh-mcp/README.md) |

## Examples

| Example | Description |
|---|---|
| [hello-agent](../examples/hello-agent/) | Minimal: one agent, one LLM, one reply |
| [traced-agent](../examples/traced-agent/) | Same as hello-agent with OpenTelemetry spans |
| [safevoice-triage](../examples/safevoice-triage/) | Multi-agent society: triage + hierarchy + critic + WhatsApp + human handoff |

## Guides

- [Architecture essay](https://corelay.dev/architecture) — the full design thesis
- [Agent-Factory thesis](https://corelay.dev/agent-factory) — why authoring-by-review matters
- [Quick start](../README.md#quick-start) — install and run in 30 seconds
- [How this compares](../README.md#how-this-compares) — vs LangGraph, Temporal, hosted platforms
- [Contributing](../README.md#contributing) — guidelines, no CLA

## Coordination patterns

| Pattern | What it does | Package |
|---|---|---|
| Pipeline | Linear sequence of peers | Implicit (peer messaging) |
| Critic | One agent challenges another's output | `mesh-coordination` |
| Debate | N agents argue to a verdict | `mesh-coordination` |
| Hierarchy | Manager decomposes, workers execute, collector merges | `mesh-coordination` |
| Human-in-the-Loop | Human peer with escalation policy and timeout | `mesh-coordination` |

## Key concepts

- **Peer** — the addressing abstraction. Agents, humans, and channels are all peers.
- **Inbox** — durable, ordered queue for messages to a peer. Memory or Postgres.
- **Capability** — permissioned declaration of what an agent can do. Enforced at dispatch.
- **Workflow** — durable execution envelope with a typed event log. Survives pod restarts.
- **Channel** — external-network adapter (WhatsApp, USSD, etc.) that surfaces users as peers.

---

*Full docs site (Starlight or similar) is planned for Q3. This index serves as the entry point until then.*
