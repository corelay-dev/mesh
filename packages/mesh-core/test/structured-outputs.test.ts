import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/tool-executor.js";
import type { ToolDefinition } from "../src/tool.js";

describe("ToolRegistry — Zod validation", () => {
  const searchSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
  });

  const searchTool: ToolDefinition = {
    name: "search",
    description: "Search for items",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
    },
    schema: searchSchema,
  };

  it("executes successfully when arguments pass Zod validation", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(searchTool, async (args) => `Found: ${args.query}`);

    const result = await registry.execute({
      id: "call-1",
      name: "search",
      arguments: { query: "typescript", limit: 10 },
    });

    expect(result.toolCallId).toBe("call-1");
    expect(result.content).toBe("Found: typescript");
    expect(result.error).toBeUndefined();
  });

  it("returns validation error when required field is missing", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(searchTool, async (args) => `Found: ${args.query}`);

    const result = await registry.execute({
      id: "call-2",
      name: "search",
      arguments: {},
    });

    expect(result.toolCallId).toBe("call-2");
    expect(result.error).toBe(true);
    expect(result.content).toContain("Validation error");
    expect(result.content).toContain("query");
  });

  it("returns validation error when field type is wrong", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(searchTool, async (args) => `Found: ${args.query}`);

    const result = await registry.execute({
      id: "call-3",
      name: "search",
      arguments: { query: "ok", limit: -5 },
    });

    expect(result.toolCallId).toBe("call-3");
    expect(result.error).toBe(true);
    expect(result.content).toContain("Validation error");
    expect(result.content).toContain("limit");
  });

  it("returns validation error with multiple issues", async () => {
    const strictSchema = z.object({
      name: z.string().min(1),
      age: z.number().int().min(0),
    });

    const tool: ToolDefinition = {
      name: "create_user",
      description: "Create user",
      parameters: { type: "object" },
      schema: strictSchema,
    };

    const registry = new ToolRegistry();
    registry.registerTool(tool, async () => "done");

    const result = await registry.execute({
      id: "call-4",
      name: "create_user",
      arguments: { name: "", age: -1 },
    });

    expect(result.error).toBe(true);
    expect(result.content).toContain("name");
    expect(result.content).toContain("age");
  });

  it("does not validate when no schema is provided (backward-compatible)", async () => {
    const registry = new ToolRegistry({
      greet: async (args) => `Hello, ${args.name}!`,
    });

    const result = await registry.execute({
      id: "call-5",
      name: "greet",
      arguments: { name: 123 },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toBe("Hello, 123!");
  });

  it("registerTool without schema behaves like register", async () => {
    const tool: ToolDefinition = {
      name: "echo",
      description: "Echo input",
      parameters: { type: "object" },
    };

    const registry = new ToolRegistry();
    registry.registerTool(tool, async (args) => String(args.msg));

    const result = await registry.execute({
      id: "call-6",
      name: "echo",
      arguments: { msg: "hello" },
    });

    expect(result.content).toBe("hello");
    expect(result.error).toBeUndefined();
  });

  it("handler errors still produce error ToolResult after schema passes", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(searchTool, async () => {
      throw new Error("Network timeout");
    });

    const result = await registry.execute({
      id: "call-7",
      name: "search",
      arguments: { query: "valid" },
    });

    expect(result.error).toBe(true);
    expect(result.content).toContain("Network timeout");
  });
});
