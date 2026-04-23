# Corelay Mesh

> Open-source multi-agent fabric. Peer-based, durably-executed, coordination-pattern-first.

**Status: Week 1 — not ready for use yet.**

Corelay Mesh is the runtime for production AI agent societies in mission-led domains. Agents coordinate as peers — including humans — on a durable workflow engine, with named coordination patterns (Pipeline, Critic, Debate, Hierarchy, Human-in-the-loop) as first-class primitives.

This repository is early. The design is stable ([platform architecture](https://corelay.dev/architecture)); the code is not. Do not depend on it yet.

## Packages

- `@corelay/mesh-core` — Agents, Peers, Inboxes, Capabilities, Workflows, Tools, Humans. *(Week 1)*
- `@corelay/mesh-postgres` — durable workflow + inbox storage on Postgres. *(Week 1)*
- `@corelay/mesh-coordination` — Pipeline, Critic, Debate, Hierarchy, Human-in-the-loop primitives. *(Week 2-3)*
- `@corelay/mesh-llm` — pluggable LLM client interface with OpenAI, Anthropic, Bedrock, Ollama implementations. *(Week 2)*
- `@corelay/mesh-mcp` — MCP client and server. *(Week 2-4)*
- `@corelay/mesh-evals` — test runner + LLM-judged scoring + pass/block thresholds. *(Week 3)*
- `@corelay/mesh-channels-*` — WhatsApp, USSD, SMS, Slack, Email, Web adapters. *(Week 2+)*
- `@corelay/mesh-observe` — OpenTelemetry integration. *(Week 2)*

## Design

- Full design: [`corelay.dev/architecture`](https://corelay.dev/architecture)
- Rebuild plan: [`corelay.dev/plan`](https://corelay.dev/plan)

## Status

| Milestone | Status |
| --- | --- |
| Repository scaffolded | ✅ |
| Core types | In progress |
| Agent + Peer + Inbox (in-memory) | Planned |
| PeerRegistry + capability enforcement | Planned |
| Postgres durable workflow v0 | Planned |
| `hello-agent` example runs end-to-end | Planned |

See [`CHANGELOG.md`](./CHANGELOG.md) for week-by-week progress.

## What Corelay Mesh is not

- Not a general-purpose agent framework. LangGraph and LangChain are.
- Not a hosted service. Corelay Studio is the hosted, commercial surface on top.
- Not a chatbot builder.
- Not ready for production use yet.

## License

MIT © [Corelay Ltd](https://corelay.dev)
