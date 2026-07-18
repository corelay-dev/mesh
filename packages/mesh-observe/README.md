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

## OpenTelemetry GenAI Semantic Conventions

This package exports typed constants and builder functions for the [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) (v1.28+). These let instrumented primitives emit standardised `gen_ai.*` attributes on spans without memorising string keys.

### Supported attributes

| Constant | Attribute key | Description |
|----------|--------------|-------------|
| `GEN_AI_SYSTEM` | `gen_ai.system` | GenAI system (e.g. "openai", "anthropic", "bedrock") |
| `GEN_AI_REQUEST_MODEL` | `gen_ai.request.model` | Requested model name |
| `GEN_AI_OPERATION_NAME` | `gen_ai.operation.name` | Operation type ("chat", "embeddings", "tool_call") |
| `GEN_AI_REQUEST_MAX_TOKENS` | `gen_ai.request.max_tokens` | Maximum generation tokens |
| `GEN_AI_REQUEST_TEMPERATURE` | `gen_ai.request.temperature` | Sampling temperature |
| `GEN_AI_REQUEST_TOP_P` | `gen_ai.request.top_p` | Nucleus sampling probability |
| `GEN_AI_USAGE_INPUT_TOKENS` | `gen_ai.usage.input_tokens` | Input tokens consumed |
| `GEN_AI_USAGE_OUTPUT_TOKENS` | `gen_ai.usage.output_tokens` | Output tokens generated |
| `GEN_AI_USAGE_TOTAL_TOKENS` | `gen_ai.usage.total_tokens` | Total tokens (input + output) |
| `GEN_AI_RESPONSE_FINISH_REASON` | `gen_ai.response.finish_reason` | Finish reason ("stop", "length", "tool_calls") |
| `GEN_AI_RESPONSE_MODEL` | `gen_ai.response.model` | Model that served the request |
| `GEN_AI_RESPONSE_ID` | `gen_ai.response.id` | Provider response ID |
| `GEN_AI_TOOL_NAME` | `gen_ai.tool.name` | Tool function name |
| `GEN_AI_TOOL_DESCRIPTION` | `gen_ai.tool.description` | Tool description |

### Builder functions

Three builder functions produce `SpanAttributes` dictionaries ready to pass directly to `tracer.span()` or `ctx.setAttributes()`:

```ts
import {
  genAiRequestAttrs,
  genAiResponseAttrs,
  genAiToolAttrs,
} from "@corelay/mesh-observe";
```

#### `genAiRequestAttrs(input)` — set on span creation

```ts
const attrs = genAiRequestAttrs({
  system: "openai",
  model: "gpt-4o",
  operationName: "chat",
  maxTokens: 4096,       // optional
  temperature: 0.7,      // optional
  topP: 0.9,             // optional
});

await tracer.span("llm.chat", attrs, async (ctx) => {
  // ...
});
```

#### `genAiResponseAttrs(input)` — set after the LLM returns

```ts
await tracer.span("llm.chat", requestAttrs, async (ctx) => {
  const response = await llm.chat(messages);

  ctx.setAttributes(genAiResponseAttrs({
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    finishReason: response.finishReason,
    responseModel: response.model,
    responseId: response.id,
  }));

  return response;
});
```

#### `genAiToolAttrs(input)` — for tool call spans

```ts
const attrs = genAiToolAttrs({
  system: "openai",
  toolName: "get_weather",
  model: "gpt-4o",                        // optional
  toolDescription: "Fetch weather data",  // optional
});

await tracer.span("tool.execute", attrs, async () => {
  return runTool(args);
});
```

### Full example: agent span with nested LLM + tool spans

```ts
import { OTelTracer, genAiRequestAttrs, genAiResponseAttrs, genAiToolAttrs } from "@corelay/mesh-observe";

const tracer = new OTelTracer({ name: "@corelay/mesh-core" });

await tracer.span(
  "agent.handle",
  genAiRequestAttrs({ system: "openai", model: "gpt-4o", operationName: "chat" }),
  async (agentCtx) => {
    // LLM call
    const response = await tracer.span(
      "llm.chat",
      genAiRequestAttrs({ system: "openai", model: "gpt-4o", operationName: "chat" }),
      async (llmCtx) => {
        const res = await llm.chat(messages);
        llmCtx.setAttributes(genAiResponseAttrs({
          inputTokens: res.usage.input,
          outputTokens: res.usage.output,
          finishReason: res.finishReason,
        }));
        return res;
      },
    );

    // Tool call
    if (response.toolCalls.length > 0) {
      await tracer.span(
        "tool.execute",
        genAiToolAttrs({ system: "openai", toolName: response.toolCalls[0].name }),
        async () => runTool(response.toolCalls[0]),
      );
    }

    agentCtx.setAttributes(genAiResponseAttrs({
      inputTokens: response.usage.input,
      outputTokens: response.usage.output,
    }));
  },
);
```

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
