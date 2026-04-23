# Changelog

All notable changes to Corelay Mesh are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning will follow [Semantic Versioning](https://semver.org/) once we cut `v0.1.0`.

## [Unreleased]

### Added

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
