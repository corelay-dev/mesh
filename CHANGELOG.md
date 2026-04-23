# Changelog

All notable changes to Corelay Mesh are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning will follow [Semantic Versioning](https://semver.org/) once we cut `v0.1.0`.

## [Unreleased]

### Added

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
