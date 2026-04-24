import { run, type Address, type PeerRegistry } from "@corelay/mesh-core";
import type { McpTool } from "./types.js";

export interface MeshAgentToolConfig {
  /** Name the MCP client sees. Kebab-case. */
  name: string;
  /** Description shown to the client's user. */
  description: string;
  /** PeerRegistry hosting the agent. */
  registry: PeerRegistry;
  /** Address of the agent to invoke. */
  agentAddress: Address;
  /** Fixed caller address so the agent can grant a capability for replies. */
  callerAddress?: Address;
  /** Timeout for each tool call, ms. Default 30000. */
  timeoutMs?: number;
  /** Override the argument property name. Default "message". */
  argumentName?: string;
}

/**
 * Wrap a Mesh Agent as an MCP tool.
 *
 * The client calls the tool with a single string argument (default "message");
 * we drive the agent via run() and return the reply as text content. The
 * simplest end-to-end story: a Claude Desktop / Cursor / ChatGPT user talking
 * to a Corelay agent.
 */
export const mcpToolFromAgent = (config: MeshAgentToolConfig): McpTool => {
  const argName = config.argumentName ?? "message";

  return {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: "object",
      properties: {
        [argName]: {
          type: "string",
          description: "The message to send to the agent.",
        },
      },
      required: [argName],
    },
    handler: async (args) => {
      const message = args[argName];
      if (typeof message !== "string") {
        throw new Error(`Argument "${argName}" must be a string`);
      }
      const result = await run(config.registry, config.agentAddress, message, {
        timeoutMs: config.timeoutMs ?? 30_000,
        ...(config.callerAddress && { from: config.callerAddress }),
      });
      return result.content;
    },
  };
};
