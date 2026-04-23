# Week 2 Plan — stub

Week 1 shipped the core primitives, an in-memory runtime, a Postgres-backed durable store, and a hello-agent example. Week 2 builds the layers that turn the core into a platform operators can trust.

## Goals

1. **Coordination primitives** — Critic, Hierarchy, Pipeline, Human-in-the-loop — as named composable Mesh modules.
2. **LLM routing** — `@corelay/mesh-llm` package with provider clients (OpenAI, Anthropic, Bedrock, Ollama) and a primary+fallback router.
3. **Observability** — `@corelay/mesh-observe` with OpenTelemetry spans for every Agent, tool call, LLM call, and workflow event.
4. **Resume after crash** — replay from the workflow event log so a restarted pod picks up mid-conversation.
5. **Channel: WhatsApp** — `@corelay/mesh-channels-whatsapp` wired to Mesh Peers.

## Explicitly deferred to Week 3+

- USSD, SMS, Slack, Email channels.
- Debate primitive (use Critic as the first second-opinion pattern; upgrade if a real use case needs N-way voting).
- MCP server-side (client-side stays a Week 3+ task).
- Studio + Compose (separate track).

## Acceptance gate for Week 2

- `examples/safevoice-triage` runs end-to-end: a Triage agent using Critic + Hierarchy + Human-in-the-loop, fronted by the WhatsApp channel, with traces visible and the workflow resumable after a restart.

Not everything; enough.
