import type { ZodType } from "zod";
import type { ToolCall, ToolDefinition, ToolResult } from "./tool.js";

/**
 * Executes tool calls returned by the LLM.
 *
 * Implementations map tool names to actual functions. The Agent calls
 * `execute()` for each tool call, feeds the results back to the LLM,
 * and repeats until the LLM produces a final text response.
 */
export interface ToolExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface ToolRegistration {
  handler: ToolHandler;
  schema?: ZodType;
}

/**
 * A ToolExecutor backed by a registry of handler functions.
 * Register handlers with `register(name, fn)` or pass a map to the constructor.
 *
 * When a ToolDefinition with a `schema` is registered via `registerTool()`,
 * the executor validates incoming arguments against the Zod schema before
 * executing. On validation failure, a typed error ToolResult is returned
 * with `error: true` and a descriptive content string, allowing the agent
 * loop to self-correct on the next round.
 */
export class ToolRegistry implements ToolExecutor {
  private readonly handlers = new Map<string, ToolRegistration>();

  constructor(handlers?: Record<string, ToolHandler>) {
    if (handlers) {
      for (const [name, fn] of Object.entries(handlers)) {
        this.handlers.set(name, { handler: fn });
      }
    }
  }

  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, { handler });
  }

  /**
   * Register a tool with its full definition, including optional Zod schema.
   * When schema is present, arguments are validated before execution.
   */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.handlers.set(definition.name, { handler, schema: definition.schema });
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const registration = this.handlers.get(call.name);
    if (!registration) {
      return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, error: true };
    }

    if (registration.schema) {
      const result = registration.schema.safeParse(call.arguments);
      if (!result.success) {
        const issues = result.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        );
        return {
          toolCallId: call.id,
          content: `Validation error: ${issues.join("; ")}`,
          error: true,
        };
      }
    }

    try {
      const content = await registration.handler(call.arguments);
      return { toolCallId: call.id, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { toolCallId: call.id, content: `Tool error: ${message}`, error: true };
    }
  }
}
