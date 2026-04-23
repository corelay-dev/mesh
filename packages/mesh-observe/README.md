# @corelay/mesh-observe

Tracing for Corelay Mesh.

A tiny `Tracer` interface with a no-op default, and an optional `OTelTracer` that emits OpenTelemetry spans when `@opentelemetry/api` is installed.

## What it does

Instrumented Corelay Mesh primitives (`Agent`, `Critic`, `Hierarchy`, `HumanPeer`, and more) accept an optional `Tracer` in their config. When one is supplied, every significant operation emits a span with useful attributes:

- `agent.handle` — one per inbound message, with model, provider, tokens, finish reason
- `llm.chat` — one per LLM call
- `coordination.critic` — one per review, with cycle count and revision flag
- `coordination.critic.critique` / `coordination.critic.revise` — inner calls
- `coordination.hierarchy` — manager-workers coordination, with contributed/missed counts
- `coordination.human.respond` — human decisions, with decision kind and actor

When no tracer is supplied, everything runs through `noopTracer` — the same code path, just recording nothing. There's no "disable tracing" branch to worry about.

## Installation

```bash
npm install @corelay/mesh-observe
```

`@opentelemetry/api` is an **optional peer dependency**. Install it only when you want real OTel spans:

```bash
npm install @opentelemetry/api
```

## Using `noopTracer` (no external deps)

```ts
import { noopTracer } from "@corelay/mesh-observe";
import { Agent } from "@corelay/mesh-core";

const agent = new Agent(address, config, llm, inbox, registry, {
  tracer: noopTracer, // explicit — same as omitting the option
});
```

## Using `OTelTracer` with a real backend

The library wraps `@opentelemetry/api`'s `startActiveSpan`. You supply the TracerProvider, exporter, and context manager — the library doesn't force any of those choices.

```ts
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTelTracer } from "@corelay/mesh-observe";

// 1. Register a context manager. Required for nested spans to propagate
//    across `await` boundaries. Choose the one for your runtime:
//      - Node:    @opentelemetry/context-async-hooks
//      - Browser: @opentelemetry/context-zone
const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

// 2. Register a TracerProvider + exporter.
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});
provider.register();

// 3. Build the Mesh Tracer.
const tracer = new OTelTracer({ name: "@corelay/mesh-core" });

// 4. Pass it to instrumented primitives.
const agent = new Agent(address, config, llm, inbox, registry, { tracer });
```

### Why you need a context manager

OpenTelemetry's concept of "the currently active span" is managed per-context. Without a context manager, an `await` inside a span body starts a new, empty context when it resumes — and any span you start after the `await` has no parent. Registering a context manager (`AsyncLocalStorageContextManager` on Node) plumbs context across async boundaries automatically, so nested `tracer.span(...)` calls produce the correct parent-child hierarchy.

If your test stack doesn't set one up, you'll see spans with distinct trace ids where you expected one. The library's own tests register one in the vitest setup for this reason.

## Exporters

`mesh-observe` doesn't wrap any specific exporter — you plug whichever you want:

- **Console** (`@opentelemetry/sdk-trace-base` → `ConsoleSpanExporter`) — fastest path to seeing spans locally.
- **OTLP HTTP** (`@opentelemetry/exporter-trace-otlp-http`) — point at Honeycomb, Tempo, or an OpenTelemetry Collector.
- **OTLP gRPC** (`@opentelemetry/exporter-trace-otlp-grpc`) — same, gRPC transport.

See the OpenTelemetry JS docs for the canonical setup.

## Status

Week 2 — in development. The API is small and unlikely to change, but it isn't locked yet.
