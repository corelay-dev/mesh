import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { OTelTracer } from "../src/otel-tracer.js";
import {
  GEN_AI_SYSTEM,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_OPERATION_NAME,
  GEN_AI_REQUEST_MAX_TOKENS,
  GEN_AI_REQUEST_TEMPERATURE,
  GEN_AI_REQUEST_TOP_P,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_TOTAL_TOKENS,
  GEN_AI_RESPONSE_FINISH_REASON,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_RESPONSE_ID,
  GEN_AI_TOOL_NAME,
  GEN_AI_TOOL_DESCRIPTION,
  genAiRequestAttrs,
  genAiResponseAttrs,
  genAiToolAttrs,
} from "../src/gen-ai-attrs.js";

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
});

afterEach(async () => {
  await provider.shutdown();
  context.disable();
  trace.disable();
});

const finishedSpans = (): ReadableSpan[] => exporter.getFinishedSpans();

describe("genAiRequestAttrs", () => {
  it("sets required gen_ai.* attributes for a request", () => {
    const attrs = genAiRequestAttrs({
      system: "openai",
      model: "gpt-4o",
      operationName: "chat",
    });

    expect(attrs[GEN_AI_SYSTEM]).toBe("openai");
    expect(attrs[GEN_AI_REQUEST_MODEL]).toBe("gpt-4o");
    expect(attrs[GEN_AI_OPERATION_NAME]).toBe("chat");
  });

  it("includes optional request parameters when provided", () => {
    const attrs = genAiRequestAttrs({
      system: "anthropic",
      model: "claude-sonnet-4-20250514",
      operationName: "chat",
      maxTokens: 4096,
      temperature: 0.7,
      topP: 0.9,
    });

    expect(attrs[GEN_AI_REQUEST_MAX_TOKENS]).toBe(4096);
    expect(attrs[GEN_AI_REQUEST_TEMPERATURE]).toBe(0.7);
    expect(attrs[GEN_AI_REQUEST_TOP_P]).toBe(0.9);
  });

  it("omits optional fields when not provided", () => {
    const attrs = genAiRequestAttrs({
      system: "openai",
      model: "gpt-4o",
      operationName: "chat",
    });

    expect(GEN_AI_REQUEST_MAX_TOKENS in attrs).toBe(false);
    expect(GEN_AI_REQUEST_TEMPERATURE in attrs).toBe(false);
    expect(GEN_AI_REQUEST_TOP_P in attrs).toBe(false);
  });
});

describe("genAiResponseAttrs", () => {
  it("sets usage token counts", () => {
    const attrs = genAiResponseAttrs({
      inputTokens: 150,
      outputTokens: 42,
      totalTokens: 192,
    });

    expect(attrs[GEN_AI_USAGE_INPUT_TOKENS]).toBe(150);
    expect(attrs[GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(42);
    expect(attrs[GEN_AI_USAGE_TOTAL_TOKENS]).toBe(192);
  });

  it("sets finish reason and response metadata", () => {
    const attrs = genAiResponseAttrs({
      finishReason: "stop",
      responseModel: "gpt-4o-2024-05-13",
      responseId: "chatcmpl-abc123",
    });

    expect(attrs[GEN_AI_RESPONSE_FINISH_REASON]).toBe("stop");
    expect(attrs[GEN_AI_RESPONSE_MODEL]).toBe("gpt-4o-2024-05-13");
    expect(attrs[GEN_AI_RESPONSE_ID]).toBe("chatcmpl-abc123");
  });

  it("omits all fields when empty input provided", () => {
    const attrs = genAiResponseAttrs({});
    expect(Object.keys(attrs)).toHaveLength(0);
  });
});

describe("genAiToolAttrs", () => {
  it("sets tool call attributes with gen_ai.operation.name = tool_call", () => {
    const attrs = genAiToolAttrs({
      system: "openai",
      toolName: "get_weather",
    });

    expect(attrs[GEN_AI_SYSTEM]).toBe("openai");
    expect(attrs[GEN_AI_OPERATION_NAME]).toBe("tool_call");
    expect(attrs[GEN_AI_TOOL_NAME]).toBe("get_weather");
  });

  it("includes model and description when provided", () => {
    const attrs = genAiToolAttrs({
      system: "anthropic",
      toolName: "search_docs",
      toolDescription: "Search documentation corpus",
      model: "claude-sonnet-4-20250514",
    });

    expect(attrs[GEN_AI_REQUEST_MODEL]).toBe("claude-sonnet-4-20250514");
    expect(attrs[GEN_AI_TOOL_DESCRIPTION]).toBe("Search documentation corpus");
  });
});

describe("GenAI attributes on OTelTracer spans", () => {
  it("emits gen_ai.* attributes on an LLM chat span", async () => {
    const tracer = new OTelTracer({ name: "test" });

    const requestAttrs = genAiRequestAttrs({
      system: "openai",
      model: "gpt-4o",
      operationName: "chat",
      maxTokens: 1024,
      temperature: 0.5,
    });

    await tracer.span("llm.chat", requestAttrs, async (ctx) => {
      ctx.setAttributes(
        genAiResponseAttrs({
          inputTokens: 200,
          outputTokens: 50,
          finishReason: "stop",
          responseModel: "gpt-4o-2024-05-13",
        }),
      );
    });

    const [span] = finishedSpans();
    // Request attributes
    expect(span?.attributes[GEN_AI_SYSTEM]).toBe("openai");
    expect(span?.attributes[GEN_AI_REQUEST_MODEL]).toBe("gpt-4o");
    expect(span?.attributes[GEN_AI_OPERATION_NAME]).toBe("chat");
    expect(span?.attributes[GEN_AI_REQUEST_MAX_TOKENS]).toBe(1024);
    expect(span?.attributes[GEN_AI_REQUEST_TEMPERATURE]).toBe(0.5);
    // Response attributes set during span
    expect(span?.attributes[GEN_AI_USAGE_INPUT_TOKENS]).toBe(200);
    expect(span?.attributes[GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(50);
    expect(span?.attributes[GEN_AI_RESPONSE_FINISH_REASON]).toBe("stop");
    expect(span?.attributes[GEN_AI_RESPONSE_MODEL]).toBe("gpt-4o-2024-05-13");
  });

  it("emits gen_ai.* attributes on a tool call span", async () => {
    const tracer = new OTelTracer({ name: "test" });

    const toolAttrs = genAiToolAttrs({
      system: "anthropic",
      toolName: "code_search",
      model: "claude-sonnet-4-20250514",
    });

    await tracer.span("tool.execute", toolAttrs, async () => "result");

    const [span] = finishedSpans();
    expect(span?.attributes[GEN_AI_SYSTEM]).toBe("anthropic");
    expect(span?.attributes[GEN_AI_OPERATION_NAME]).toBe("tool_call");
    expect(span?.attributes[GEN_AI_TOOL_NAME]).toBe("code_search");
    expect(span?.attributes[GEN_AI_REQUEST_MODEL]).toBe("claude-sonnet-4-20250514");
  });

  it("emits gen_ai.* on an agent span with nested LLM child", async () => {
    const tracer = new OTelTracer({ name: "test" });

    await tracer.span(
      "agent.handle",
      genAiRequestAttrs({
        system: "openai",
        model: "gpt-4o",
        operationName: "chat",
      }),
      async (agentCtx) => {
        // Simulate LLM call inside agent
        await tracer.span(
          "llm.chat",
          genAiRequestAttrs({
            system: "openai",
            model: "gpt-4o",
            operationName: "chat",
          }),
          async (llmCtx) => {
            llmCtx.setAttributes(
              genAiResponseAttrs({
                inputTokens: 300,
                outputTokens: 100,
                totalTokens: 400,
                finishReason: "stop",
              }),
            );
          },
        );
        // Set token totals on the agent span too
        agentCtx.setAttributes(
          genAiResponseAttrs({
            inputTokens: 300,
            outputTokens: 100,
            totalTokens: 400,
          }),
        );
      },
    );

    const spans = finishedSpans();
    expect(spans).toHaveLength(2);

    const llmSpan = spans.find((s) => s.name === "llm.chat")!;
    const agentSpan = spans.find((s) => s.name === "agent.handle")!;

    // LLM span has full GenAI attributes
    expect(llmSpan.attributes[GEN_AI_SYSTEM]).toBe("openai");
    expect(llmSpan.attributes[GEN_AI_USAGE_INPUT_TOKENS]).toBe(300);
    expect(llmSpan.attributes[GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(100);
    expect(llmSpan.attributes[GEN_AI_USAGE_TOTAL_TOKENS]).toBe(400);
    expect(llmSpan.attributes[GEN_AI_RESPONSE_FINISH_REASON]).toBe("stop");

    // Agent span also carries aggregated usage
    expect(agentSpan.attributes[GEN_AI_SYSTEM]).toBe("openai");
    expect(agentSpan.attributes[GEN_AI_USAGE_INPUT_TOKENS]).toBe(300);
    expect(agentSpan.attributes[GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(100);

    // Parent-child relationship
    expect(llmSpan.spanContext().traceId).toBe(agentSpan.spanContext().traceId);
  });

  it("is backward compatible — existing non-GenAI attributes still work", async () => {
    const tracer = new OTelTracer({ name: "test" });

    await tracer.span(
      "custom.work",
      { tenant: "acme", count: 5 },
      async (ctx) => {
        ctx.setAttribute("result", "success");
      },
    );

    const [span] = finishedSpans();
    expect(span?.name).toBe("custom.work");
    expect(span?.attributes.tenant).toBe("acme");
    expect(span?.attributes.count).toBe(5);
    expect(span?.attributes.result).toBe("success");
  });
});
