import { describe, it, expect } from "vitest";
import {
  Agent,
  MemoryInbox,
  PeerRegistry,
  type AgentConfig,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
} from "@corelay/mesh-core";
import { mcpToolFromAgent } from "../src/index.js";

class EchoingLLM implements LLMClient {
  readonly name = "echo";
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return {
      content: `You said: ${lastUser?.content ?? ""}`,
      model: request.model,
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    };
  }
}

const CALLER = "mcp/caller" as const;

const buildAgent = async (): Promise<{ registry: PeerRegistry; address: "demo/assistant" }> => {
  const registry = new PeerRegistry();
  const address = "demo/assistant" as const;
  const config: AgentConfig = {
    name: "assistant",
    description: "echoes",
    prompt: "repeat",
    model: "t",
    maxResponseTokens: 100,
    welcomeMessage: "",
    guardrails: "",
    tools: [],
    capabilities: [{ kind: "peer", address: CALLER }],
  };
  const agent = new Agent(address, config, new EchoingLLM(), new MemoryInbox(), registry);
  registry.register(agent);
  await agent.start();
  return { registry, address };
};

describe("mcpToolFromAgent", () => {
  it("produces an MCP tool with the expected schema", async () => {
    const { registry, address } = await buildAgent();
    const tool = mcpToolFromAgent({
      name: "ask-assistant",
      description: "Ask the demo assistant.",
      registry,
      agentAddress: address,
      callerAddress: CALLER,
    });
    expect(tool.name).toBe("ask-assistant");
    expect(tool.inputSchema.required).toEqual(["message"]);
    expect(tool.inputSchema.properties.message).toBeDefined();
  });

  it("drives the agent end-to-end and returns the reply text", async () => {
    const { registry, address } = await buildAgent();
    const tool = mcpToolFromAgent({
      name: "ask-assistant",
      description: "x",
      registry,
      agentAddress: address,
      callerAddress: CALLER,
    });
    const output = await tool.handler({ message: "hi there" });
    expect(output).toContain("You said: hi there");
  });

  it("honours a custom argumentName", async () => {
    const { registry, address } = await buildAgent();
    const tool = mcpToolFromAgent({
      name: "custom",
      description: "x",
      registry,
      agentAddress: address,
      callerAddress: CALLER,
      argumentName: "query",
    });
    expect(tool.inputSchema.required).toEqual(["query"]);
    const output = await tool.handler({ query: "something" });
    expect(output).toContain("You said: something");
  });

  it("throws when the argument is not a string", async () => {
    const { registry, address } = await buildAgent();
    const tool = mcpToolFromAgent({
      name: "custom",
      description: "x",
      registry,
      agentAddress: address,
      callerAddress: CALLER,
    });
    await expect(tool.handler({ message: 42 })).rejects.toThrow('"message"');
  });
});
