# Changelog

All notable changes to Corelay Mesh are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning will follow [Semantic Versioning](https://semver.org/) once we cut `v0.1.0`.

## [Unreleased]

### Added

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
