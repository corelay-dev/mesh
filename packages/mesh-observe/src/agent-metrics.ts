/**
 * Standard metric instruments for agent workloads.
 *
 * Pre-defined counters and histograms using GenAI semantic-convention
 * attribute names. Instruments are created lazily from a Meter instance —
 * pass noopMeter when metrics are disabled.
 */
import type { Counter, Histogram, Meter } from "./meter.js";

export interface AgentMetrics {
  /** Total requests handled by the agent. */
  readonly requestsTotal: Counter;
  /** Total tool invocation errors. */
  readonly toolErrorsTotal: Counter;
  /** Total messages processed (across all conversations). */
  readonly messagesProcessedTotal: Counter;
  /** LLM call latency in milliseconds. */
  readonly llmLatencyMs: Histogram;
  /** Token usage (input/output/total per recording). */
  readonly tokens: Histogram;
  /** Estimated cost in USD per LLM call. */
  readonly costUsd: Histogram;
}

/**
 * Create the standard set of agent metrics from a Meter.
 *
 * Attribute names on recordings should use the GenAI semantic-convention
 * constants exported from this package (GEN_AI_SYSTEM, GEN_AI_REQUEST_MODEL,
 * etc.) for consistency with the tracing layer.
 */
export const createAgentMetrics = (meter: Meter): AgentMetrics => ({
  requestsTotal: meter.createCounter("gen_ai.agent.requests_total", {
    description: "Total requests handled by the agent",
    unit: "{request}",
  }),
  toolErrorsTotal: meter.createCounter("gen_ai.agent.tool_errors_total", {
    description: "Total tool invocation errors",
    unit: "{error}",
  }),
  messagesProcessedTotal: meter.createCounter(
    "gen_ai.agent.messages_processed_total",
    {
      description: "Total messages processed",
      unit: "{message}",
    },
  ),
  llmLatencyMs: meter.createHistogram("gen_ai.agent.llm_latency", {
    description: "LLM call latency",
    unit: "ms",
  }),
  tokens: meter.createHistogram("gen_ai.agent.tokens", {
    description: "Token usage per LLM call",
    unit: "{token}",
  }),
  costUsd: meter.createHistogram("gen_ai.agent.cost", {
    description: "Estimated cost per LLM call",
    unit: "USD",
  }),
});
