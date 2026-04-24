<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

# Corelay Mesh

**An open-source multi-agent fabric for production agent societies.**

Peers, durable workflows, named coordination patterns, and humans as first-class participants — in one small, composable library.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/corelay-dev/mesh/actions/workflows/ci.yml/badge.svg)](https://github.com/corelay-dev/mesh/actions)
[![npm: @corelay/mesh-core](https://img.shields.io/badge/npm-%40corelay%2Fmesh--core-blue)](https://www.npmjs.com/package/@corelay/mesh-core)

[Architecture essay](https://corelay.dev/architecture) · [Website](https://corelay.dev) · [Examples](./examples)

</div>

---

## Why Mesh

Most agent frameworks treat orchestration as a god-object: one controller that loads prompts, calls models, routes outputs, and holds the graph of who talks to whom. It works in a notebook. It falls apart the moment a human needs to step in, a model needs to be swapped, a conversation needs to survive a pod restart, or a second tenant needs a different variant of the same flow.

Mesh takes a different shape. Agent systems are **societies of peers**: an agent is a configured AI addressable by a name, a human is another peer with a slower inbox, a channel adapter is a peer that happens to bridge WhatsApp, and coordination patterns — Critic, Debate, Hierarchy — are first-class shapes the society composes. Everything is a peer. The controller goes away.

Read the full thesis at [corelay.dev/architecture](https://corelay.dev/architecture).

## Features

- **Six small, orthogonal primitives** — `Agent`, `Peer`, `Inbox`, `Capability`, `Workflow`, `Channel`. Every higher-level feature is composed from these.
- **Five named coordination patterns** — Pipeline, Critic, Debate, Hierarchy, Human-in-the-Loop. Not library add-ons; part of the core vocabulary.
- **Durable execution over Postgres** — workflows survive pod restarts with at-least-once delivery and idempotency. Proven end-to-end with testcontainers.
- **Humans as first-class peers** — a person is an addressable `Peer` with a slower inbox. Escalation policies, timeouts, and audit trails work identically for agents and humans.
- **Capability enforcement** — an agent can only address peers in its `capabilities`. Violations raise `CapabilityError`, not quiet success.
- **OpenTelemetry-instrumented** — every agent call, tool call, critic loop, and human handoff produces spans. Plug your own exporter.
- **Channel adapters** — WhatsApp Cloud API today; USSD / SMS / Slack / voice scoped for later.
- **LLM router** — OpenAI, Anthropic, Bedrock. Primary + fallback chains, typed.
- **TypeScript throughout** — strict mode, `noUncheckedIndexedAccess`, ESM-only.

## Quick start

```bash
npm install @corelay/mesh-core @corelay/mesh-llm openai
```

```ts
import OpenAI from "openai";
import {
  Agent,
  MemoryInbox,
  PeerRegistry,
  run,
  type AgentConfig,
} from "@corelay/mesh-core";
import { LLMRouter, OpenAIClient } from "@corelay/mesh-llm";

const CALLER = "demo/caller" as const;
const ASSISTANT = "demo/assistant" as const;

const openai = new OpenAIClient({
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }),
});
const llm = new LLMRouter({ primary: openai.name, providers: [openai] });

const config: AgentConfig = {
  name: "assistant",
  description: "Concise, helpful.",
  prompt: "You are a concise, helpful assistant. One sentence.",
  model: "gpt-4o-mini",
  maxResponseTokens: 200,
  welcomeMessage: "",
  guardrails: "",
  tools: [],
  capabilities: [{ kind: "peer", address: CALLER }],
};

const registry = new PeerRegistry();
const agent = new Agent(ASSISTANT, config, llm, new MemoryInbox(), registry);
registry.register(agent);
await agent.start();

const result = await run(registry, ASSISTANT, "What is a peer society?", {
  from: CALLER,
});

console.log(result.content);
```

For a full working example with LLM fallbacks, see [`examples/hello-agent`](./examples/hello-agent). For a multi-agent society with Critic, Hierarchy, and Human-in-the-Loop, see [`examples/safevoice-triage`](./examples/safevoice-triage).

## Packages

| Package | Purpose | Status |
| --- | --- | --- |
| `@corelay/mesh-core` | Agent, Peer, Inbox, Capability, Workflow types, PeerRegistry, `run()` | ✅ Shipping |
| `@corelay/mesh-postgres` | Durable `WorkflowStore`, `PostgresInbox`, `sweepStaleWorkflows` | ✅ Shipping |
| `@corelay/mesh-llm` | `LLMRouter` with OpenAI, Anthropic, Bedrock clients | ✅ Shipping |
| `@corelay/mesh-coordination` | Critic, Hierarchy, HumanPeer with `EscalationPolicy` | ✅ Shipping |
| `@corelay/mesh-channels-whatsapp` | WhatsApp Cloud API — parser, client, userPeer, webhook | ✅ Shipping |
| `@corelay/mesh-observe` | `Tracer` interface, `noopTracer`, OpenTelemetry implementation | ✅ Shipping |
| `@corelay/mesh-eval` | Eval suites, deploy-gates, shadow/canary | ✅ Shipping v0.1 |
| `@corelay/mesh-compose` | Authoring agent (Corelay Compose) | ✅ Shipping v0.2 |
| `@corelay/mesh-mcp` | MCP server side (client side already covered by the ecosystem) | 🛠 Q1 2026 |

## Durable execution

Conversations with survivors, revenue officers, and caseworkers can span hours or days. The system must survive pod restarts, network blips, tool timeouts, and human delays. Mesh treats every workflow as a durable envelope with a typed event log.

```ts
import { Pool } from "pg";
import { WorkflowStore, PostgresInbox } from "@corelay/mesh-postgres";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

const store = new WorkflowStore({ pool });
const inbox = new PostgresInbox({ pool, address: "safevoice/triage" });

// Wire the inbox into an Agent exactly like MemoryInbox. Pass `store` as the
// `recorder` to run() to persist workflow events end-to-end. If the process
// dies mid-run, sweepStaleWorkflows() lets another pod pick up from the
// event log and continue.
```

The `test/` suites in `packages/mesh-postgres` include integration tests (via [testcontainers](https://node.testcontainers.org/)) that prove this: real Postgres, worker killed mid-run, resumed on a second worker, final state asserted.

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────┐
│                     Corelay Studio                       │
│            (closed source · commercial)                  │
│   Compose  ·  Command Centre  ·  Eval-gated deploy       │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                      Corelay Mesh                        │
│             (open source · MIT · this repo)              │
│                                                           │
│   Primitives:  Agent · Peer · Inbox · Capability ·       │
│                Workflow · Channel                         │
│                                                           │
│   Coordination: Pipeline · Critic · Debate ·             │
│                 Hierarchy · Human-in-the-Loop            │
└──────────────────────────────────────────────────────────┘
```

**Mesh** (this repo) is the open-source fabric. **Studio** is the commercial surface: an authoring agent (Compose), a Command Centre for operations, and an eval-gated deploy pipeline. **SafeVoice** — the flagship product Corelay is building on Mesh — is a survivor-first WhatsApp triage service for NGOs.

Full design at [corelay.dev/architecture](https://corelay.dev/architecture).

## How this compares

Be honest about what you're evaluating: Mesh is not a drop-in replacement for existing tools. It's a different shape.

- **Agent graph frameworks** (LangGraph, CrewAI, AutoGen): graph-of-nodes where nodes are function calls; messages flow as state. Mesh is peer-addressable — an agent sends to `tenant/role` without knowing who ends up receiving it, and humans are addressed the same way. Coordination patterns (Critic, Debate, Hierarchy, Human-in-the-Loop) are primitives, not patterns you reassemble.
- **Workflow engines** (Temporal, Inngest, Restate): excellent at durable execution, not designed as agent fabrics. Mesh puts durability and peer messaging in the same layer because that's where the hard integration work lives. If you want Temporal-class features (signals, sideways retries) at the workflow boundary, you can integrate there.
- **Hosted agent platforms**: Mesh is self-hostable MIT infrastructure. Corelay Studio — the hosted commercial surface — is a separate, optional product built on top of Mesh.

If any of these tools fits your problem better, use it. Mesh is for teams whose production agent systems look more like societies than pipelines.

## Development

Requirements: Node 20+, Postgres 16+ (only for `@corelay/mesh-postgres` integration tests), Docker (testcontainers).

```bash
npm install
npm run build
npm test
```

Monorepo structure: `packages/*` (libraries) and `examples/*` (demos). Managed with npm workspaces and [Turborepo](https://turbo.build).

## Contributing

Issues and pull requests welcome. We accept small PRs eagerly; for larger changes, please open an issue first to discuss shape. There is **no CLA** — contributions are MIT, same as the repo.

Guidelines:

- One concern per commit. We prefer five small commits to one large one.
- Tests required for non-trivial changes. `npm test` must pass.
- TypeScript strict mode, `noUncheckedIndexedAccess`. No `any`.
- Conventional Commits format for messages (`feat:`, `fix:`, `chore:`, etc.).

## Security

Found a vulnerability? Email <security@corelay.dev> rather than opening a public issue. We'll respond within 72 hours and coordinate disclosure.

## Status and versioning

Mesh is pre-1.0. Packages are on `0.x` and may change shape between minor versions before `1.0.0` ships. We take care to document breakages; you can track them in [`CHANGELOG.md`](./CHANGELOG.md).

Target for `1.0.0`: Q3 2026, with semver lock and a documented migration path.

## License

MIT © [Corelay Ltd](https://corelay.dev)

---

<div align="center">

**Mesh is one of three artefacts Corelay ships: Mesh (open source), Compose (authoring agent), SafeVoice (flagship product).**

[corelay.dev](https://corelay.dev) · [Architecture](https://corelay.dev/architecture) · [Pilot partnerships](https://corelay.dev/pricing)

</div>
