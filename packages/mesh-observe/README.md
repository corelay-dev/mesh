# @corelay/mesh-observe

Tracing for Corelay Mesh.

A tiny `Tracer` interface with a no-op default, and an optional `OTelTracer` that emits OpenTelemetry spans when `@opentelemetry/api` is installed.

**Status: Week 2 — in development.**

## Why a tracer interface and not OTel directly?

Two reasons:

1. **Zero-dep core.** `@corelay/mesh-core` and the coordination/channel packages don't pull `@opentelemetry/api` unless you want it. The `Tracer` interface is small enough to live in one file.
2. **Test stub built in.** `noopTracer` lets unit tests instantiate instrumented primitives without wiring a real tracer.

Install `@opentelemetry/api` alongside this package when you want real spans.
