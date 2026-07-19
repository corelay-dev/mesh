# Changelog

All notable changes to Corelay Mesh are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning will follow [Semantic Versioning](https://semver.org/) once we cut `v0.1.0`.

## [Unreleased]

### Added

#### 2026 agentic modernization

- **@corelay/mesh-llm v0.3** — Prompt caching (Anthropic `cache_control`, OpenAI cached input, Bedrock), USD cost tracking with optional budget caps, streaming (`chatStream`), extended-thinking / `reasoning_effort` support, and provider-enforced structured outputs (strict JSON schema).
- **@corelay/mesh-core v0.4** — Parallel tool execution, context compaction + tool-result clearing, dynamic runtime peer registration/spawning, Zod tool-argument validation, opt-in **ReAct / Plan-and-Execute / Reflexion** loop strategies, and a `MemoryStore` interface.
- **@corelay/mesh-retrieval v0.2** — Hybrid search (BM25 + Reciprocal Rank Fusion), pluggable reranker, and a retriever-backed semantic `MemoryStore` adapter.
- **@corelay/mesh-mcp v0.3** — MCP **client** to consume external MCP tool servers (complements the existing server).
- **@corelay/mesh-a2a v0.2** — Streaming (`tasks/sendSubscribe`, `tasks/resubscribe`) and push notifications.
- **@corelay/mesh-observe v0.4** — OpenTelemetry **metrics** layer (counters + histograms) alongside tracing, using GenAI semantic-convention attributes.
- **@corelay/mesh-eval v0.3** — CLI runner + GitHub Actions eval-gate workflow (mock judge so CI passes without API keys).
- **@corelay/mesh-postgres v0.3** — Durable Postgres-backed `ConversationMemory` for cross-session history.

- **@corelay/mesh-compose v0.3** — Critic-wrapped authoring via `createCriticAuthor()`. Drafts are automatically challenged by the Critic primitive before the reviewer sees them.
- **@corelay/mesh-eval v0.2** — `compareReports()` for regression detection between eval runs. Cases matched by id; removed cases count as regressions; deploy decision requires zero regressions + candidate gate passed.
- **@corelay/mesh-mcp v0.1** — MCP server exposing Mesh agents as tools for Claude Desktop / Cursor / ChatGPT. `McpServer` handles initialize, tools/list, tools/call, ping. `mcpToolFromAgent()` wraps any Agent as an MCP tool. `stdioTransport()` for the wire protocol. Zero external dependencies.
- **@corelay/mesh-coordination: Debate primitive** — N participants argue across configurable rounds with three judge kinds (rule, human, LLM). Full exchange returned for audit.
- **@corelay/mesh-compose v0.2** — `createLlmAuthor()` wraps any LLMClient as a Compose author. `renderSpec()` deterministically renders a ComposeSpec as the prompt the author sees.
- **@corelay/mesh-compose v0.1** — `compose()`, `approve()`, `reject()`. ComposeSpec → ComposeDraft with per-field provenance tracking. Structural impossibility of auto-save.
- **@corelay/mesh-eval v0.1** — `runEval()` suite runner with four assertion kinds (contains, notContains, matches, judged), `createLlmJudge()`, weighted scoring, gate decisions.
- **Compose → Agent → Eval integration test** — proves the full deploy story end-to-end in one test.
- **Flagship README** — working quick-start code, package table, architecture diagram, "how this compares" section, contributing/security/versioning.
- **docs/index.md** — entry point for mesh.corelay.dev linking every package, example, guide, and concept.

### Changed

- All `@corelay/*` packages now have `repository`, `homepage`, `bugs`, `author` metadata pointing to `corelay-dev/mesh`.
- `@loom-examples/hello-agent` renamed to `@mesh-examples/hello-agent`.
- Repo transferred from `deejaycodes/mesh` to `corelay-dev/mesh`.

### Stats

- **17 packages**, modernized to 2026 agentic standards: prompt caching, streaming, parallel tools, structured outputs, reasoning strategies (ReAct/Plan-Execute/Reflexion), context engineering, long-term memory, hybrid RAG, MCP client, A2A streaming, and OTel metrics.
- **5 coordination patterns**: Pipeline, Critic, Debate, Hierarchy, Human-in-the-Loop.

---

### Previously shipped (Week 1-2)
  - Normal-risk scenario: `handleWebhook` → `managerPeer` with `LLMDecomposer` + `LLMMerger` → safety-planner + service-finder worker agents in parallel → merged reply → `withCritic` against triage guardrails → `UserPeer` outbound (captured via stubbed `fetch`).
  - High-risk scenario: keyword classifier → inbound routed to `HumanPeer` caseworker worklist → simulated caseworker `edit` decision → Silent-Solution guidance delivered back to the user.
  - OpenTelemetry traces printed via `ConsoleSpanExporter`: `agent.handle`, `llm.chat`, `coordination.hierarchy`, `coordination.critic` + `.critique` + `.revise`, `coordination.human.respond`. Full parent-child chain preserved.
  - Runs with only `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`. No Meta developer account or Postgres required for the demo.

- **Week 2 · Resume after crash:** durability proven end-to-end + workflow reconciler.
  - Two new `PostgresInbox` integration tests prove the crash-and-resume shape: a restarted consumer picks up unclaimed rows from a crashed predecessor, and a new consumer picks up messages whose handler was killed mid-flight. Durability guarantee is at-least-once; handlers must be idempotent on `Message.id`.
  - `sweepStaleWorkflows` — background reconciler that marks `running` workflows as `failed` if they haven't been updated past a configurable threshold (default 5 minutes). Concurrency-safe, bounded per-call limit, runs on whatever schedule the caller prefers (cron, setInterval, Temporal).
  - 4 integration tests covering sweeper correctness (stale vs fresh, terminal-status preservation, limit, no-op path).

- **Week 2 · Observability (part 2):** fills in the flags from part 1.
  - `Critic`, `Hierarchy`, and `HumanPeer` each accept an optional `tracer` in their config and emit named spans: `coordination.critic` (with inner `coordination.critic.critique` and `coordination.critic.revise` per cycle), `coordination.hierarchy` (with worker contributed/missed counts), and `coordination.human.respond` (with decision kind and actor). Default remains `noopTracer` so existing tests continue to pass.
  - `@corelay/mesh-observe` README documents Tracer usage with `noopTracer` and `OTelTracer`, calls out the context-manager requirement and what breaks without one, and lists the exporter choices (Console, OTLP HTTP/gRPC).
  - New `examples/traced-agent` — `hello-agent` with a full OTel pipeline (AsyncLocalStorage context manager + BasicTracerProvider + ConsoleSpanExporter + OTelTracer). Prints the span tree to stdout so the tracing contract is demonstrable without a real backend.

- **Week 2 · Observability (part 1):** new `@corelay/mesh-observe` package + Agent instrumentation.
  - `Tracer` interface — tiny contract (`span(name, attrs, fn)`) consumed by instrumented Mesh primitives. `SpanContext` lets the body `setAttribute(s)`, `recordException`, and `setStatus`. Attributes are narrowly typed.
  - `noopTracer` — default. Runs the function, records nothing. Means "no instrumentation" is the same code path as instrumented code, just cheaper.
  - `OTelTracer` — backed by `@opentelemetry/api`, uses `startActiveSpan` so nested spans propagate through the OTel context automatically. Exceptions record as span events with status=ERROR before propagating.
  - `@opentelemetry/api` is an optional peer dependency; consumers who don't want real OTel ship with just `noopTracer`.
  - Tests: `Tracer` contract tests (runs against `noopTracer`, extensible to any implementation) plus OTel-specific span-shape tests using `InMemorySpanExporter`.
  - **Agent instrumentation**: `Agent` constructor gains `AgentOptions.tracer`. Emits `agent.handle` (outer) and `llm.chat` (inner) spans with useful attributes: address, model, provider, prompt/completion/total tokens, finish reason, message trace id. Non-breaking — defaults to `noopTracer`.

- **Week 2 · WhatsApp channel:** new `@corelay/mesh-channels-whatsapp` package.
  - `parseWebhookBody` + `toMessage` — Meta Cloud API webhook payload → `@corelay/mesh-core` `Message`. Text-only in Week 2; malformed or non-text events return empty without throwing.
  - `WhatsAppClient.sendText` — thin POST to Meta's `/messages` endpoint with injectable `fetch` and configurable Graph API version.
  - `userPeer(config)` — outbound `Peer` at address `whatsapp/<phone>`; `send()` dispatches via `WhatsAppClient`. Per-message `metadata.whatsapp.phoneNumberId` overrides the client's default sender so replies go through the same Meta phone that received the inbound.
  - `handleWebhook(config, request)` — framework-agnostic entry point that performs the Meta subscription challenge (GET) and delivers inbound messages via a PeerRegistry (POST). Auto-registers a `userPeer` for each new sender address on first contact. Always returns 200 on POST (malformed body, delivery failure) because Meta retries non-2xx and generates duplicates.
  - 23 tests covering parser, client, userPeer routing, and webhook handler (challenge, malformed body, auto-register, delivery failure, wrong method).

- **Week 2 · Human-in-the-loop primitive:** humans as peers in `@corelay/mesh-coordination`.
  - `HumanPeer` — a `Peer` that stores inbound messages in a durable worklist (via any `Inbox`, including `PostgresInbox`), exposes them via `list()`, and lets a real human (via UI, API, or channel reply) record a decision via `respond(itemId, action)`. Decisions: `approve` (forward original), `reject` (forward reason), `edit` (forward edited content), `reassign` (forward original to a different address).
  - `EscalationPolicy` — optional per-item timeout with either `reject` or `reassign` semantics, so stalled flows don't block indefinitely. Escalation replies carry `actor: "system:escalation"` to distinguish from real human actions.
  - 13 tests: 9 covering every decision kind and validation error, 4 covering escalation (reject mode, reassign mode, no-escalation on timely response, `stop()` cancels timers).
  - "Durable pause" means a message sits in the human's inbox until a human acts — no in-process wait. Matches how real caseworkers, inspectors, and reviewers integrate.

- **Week 2 · Hierarchy primitive:** manager-workers coordination in `@corelay/mesh-coordination`.
  - `Hierarchy` — decomposes a task via a `TaskDecomposer`, dispatches per-worker sub-tasks as Peer messages, collects replies on a temporary collector peer, and merges via a `ResultMerger`. Parallel fan-out by default; sequential available. Configurable timeout; missed workers surfaced in `HierarchyResult`.
  - `LLMDecomposer` + `LLMMerger` — default LLM-backed implementations. Injectable `LLMClient` and model so any router plugs in.
  - `managerPeer(config)` — composition helper that turns a `Hierarchy` into a `Peer`. Caller addresses the manager-peer; the merged answer is forwarded to `forwardTo` with `metadata.hierarchy` recording contributions and missed workers.
  - 10 tests total: 5 unit tests for `Hierarchy` (dispatch, selective assignment, timeout surfacing, empty assignments, collector cleanup), 4 for the LLM helpers (JSON parsing, malformed-JSON fallback, empty-merge default, results formatting), 1 integration test exercising manager-peer + Agents + Hierarchy end-to-end.

### Fixed

- **Hierarchy dispatch from-address:** dispatched sub-task messages now use the collector address as `from`, so Agent-backed workers route replies to the collector. Previously the manager's address was used, which meant Agents replied to the manager and bypassed the collector — silently timing out the hierarchy.

- **Week 2 · Critic primitive:** new `@corelay/mesh-coordination` package.
  - `Critic` — dialectical thesis → antithesis → synthesis review. Injectable `LLMClient` and model id, configurable `maxCycles` (default 2), `autoApproveBelowChars` short-circuit (default 50). Returns `CriticVerdict { content, cycles, revised, lastCritique }`.
  - `withCritic(config)` — composition helper that returns a `Peer` which critiques every inbound message and forwards the (possibly revised) result to a configured `forwardTo` address. `Message.metadata.critic` records `{ revised, cycles, lastCritique }` for traces.
  - 8 tests: 6 unit tests for `Critic` (auto-approve, first-cycle approve, revise-then-approve, max-cycles fallback, guardrail injection, system-prompt separation); 2 integration tests exercising Agent + `withCritic` end-to-end.

- **Week 2 · LLM routing:** new `@corelay/mesh-llm` package.
  - `LLMRouter` — composes a primary provider and ordered fallbacks; implements `LLMClient` so it drops into any Agent.
  - `OpenAIClient` — adapts the OpenAI SDK (tool calls, usage, finish reasons).
  - `AnthropicClient` — adapts the Anthropic SDK, handles system-message concatenation and tool_result translation.
  - `BedrockClient` — adapts AWS Bedrock's InvokeModelCommand for Anthropic Claude models. Non-Claude model ids throw a clear error until Nova support is added.
  - All SDKs are optional peer dependencies; install only the providers you use.
  - 25 unit tests exercising the router and each provider via mock SDKs.
  - `examples/hello-agent` now uses the router — primary OpenAI, fallback Anthropic, both optional at runtime.

- **Post-Week-1 cleanup:** closing the gaps flagged at the end of Week 1.
  - `WorkflowRecorder` interface in `@corelay/mesh-core` — write-side contract for durable workflows.
  - `run()` gained an optional `recorder` parameter. When supplied, it creates a workflow, records message_sent + message_delivered events, and marks completed/failed on terminal outcomes.
  - `WorkflowStore` now declares `implements WorkflowRecorder`.
  - Testcontainers-based integration tests for `WorkflowStore` (4 tests), `PostgresInbox` (4 tests), and end-to-end `run()` + `WorkflowStore` (1 test).

- **Day 5 (Week 1):** Durability foundations + end-to-end example.
  - `Workflow`, `WorkflowEvent`, `WorkflowStatus`, `WorkflowEventKind` types in `@corelay/mesh-core`.
  - `@corelay/mesh-postgres` package scaffolded.
  - SQL schema (`sql/001-init.sql`): `workflows`, `workflow_events`, `inbox_messages` tables, keyed on epoch-millis timestamps, partial index for unclaimed inbox rows.
  - `WorkflowStore` — durable workflow + append-only event log.
  - `PostgresInbox` — polling consumer with at-least-once semantics; failed handlers leave rows unclaimed for retry.
  - `run(registry, rootAddress, userMessage)` convenience helper with timeout.
  - `examples/hello-agent` — end-to-end example against a real OpenAI key (`gpt-4o-mini`).
- **Day 4 (Week 1):** Address-based routing and capability enforcement.
  - `PeerRegistry` — in-process routing keyed by Address with `UnknownPeerError` for misses.
  - `Agent` refactored to route replies via the registry (removing the Day 3 `lastReply` stash).
  - `CapabilityError` — thrown when an Agent tries to send to a peer address it has no `PeerCapability` for.
  - Two-agent tests proving address-based coordination end-to-end.
- **Day 3 (Week 1):** First runtime code.
  - `MemoryInbox` — single-process `Inbox` implementation; delivers messages in append order, resilient to handler exceptions.
  - `Agent` — minimal peer that reads one message, calls the configured `LLMClient`, and stashes `lastReply`. No tools, memory, critic, or registry yet.
  - Runtime tests: 4 for `MemoryInbox`, 3 for `Agent` using an in-test mock LLM (no network).
- **Day 2 (Week 1):** Public types for `@corelay/mesh-core`. No implementations yet.
  - `Address` + `parseAddress()` for `tenant/role[/instance]` peer addressing.
  - `Message` envelope with discriminated `MessageKind` (`user`/`assistant`/`tool`/`system`/`peer`).
  - `Peer` and `Inbox` interfaces.
  - `Capability` discriminated union (`tool`/`peer`/`channel`).
  - `ToolDefinition`, `ToolCall`, `ToolResult`.
  - `LLMClient` interface + `LLMRequest`, `LLMResponse`, `LLMMessage`, `TokenUsage`.
  - `AgentConfig` pulling the above together.
  - Type-level compile-time assertions for all public types (`test/types.test-d.ts`).
- **Day 1 (Week 1):** Repository scaffolded. npm workspace, Turborepo pipeline, base TypeScript config, MIT license, GitHub Actions CI, `.nvmrc`, empty `@corelay/mesh-core` package with a passing smoke test.
