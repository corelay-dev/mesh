import type { Address } from "./address.js";
import type { AgentConfig } from "./agent-config.js";
import type { Inbox } from "./inbox.js";
import type { LLMClient } from "./llm.js";
import type { Message } from "./message.js";
import type { Peer } from "./peer.js";
import type { PeerRegistry } from "./peer-registry.js";

/**
 * Raised when an Agent tries to send a message to a peer address it does not
 * have a PeerCapability for. Stops accidental or malicious cross-peer sends.
 */
export class CapabilityError extends Error {
  constructor(
    public readonly agent: Address,
    public readonly target: Address,
  ) {
    super(`Agent ${agent} has no peer capability for ${target}`);
    this.name = "CapabilityError";
  }
}

/**
 * Agent — a peer that receives messages via its Inbox, calls the LLM, and
 * delivers the reply back to the sender through the PeerRegistry.
 *
 * Every outbound peer message is checked against the agent's declared
 * capabilities. The agent may only send to addresses explicitly granted via
 * a `PeerCapability`.
 *
 * Still deliberately minimal: no tool calls, no memory, no critic, no
 * learnings. Those arrive as separate primitives in later weeks.
 */
export class Agent implements Peer {
  constructor(
    public readonly address: Address,
    private readonly config: AgentConfig,
    private readonly llm: LLMClient,
    private readonly inbox: Inbox,
    private readonly registry: PeerRegistry,
  ) {}

  async start(): Promise<void> {
    await this.inbox.consume((m) => this.handle(m));
  }

  async send(message: Message): Promise<void> {
    await this.inbox.append(message);
  }

  private async handle(message: Message): Promise<void> {
    const response = await this.llm.chat({
      messages: [
        { role: "system", content: this.config.prompt },
        { role: "user", content: message.content },
      ],
      model: this.config.model,
      maxTokens: this.config.maxResponseTokens,
    });

    const reply: Message = {
      id: `${message.id}-reply`,
      from: this.address,
      to: message.from,
      kind: "assistant",
      content: response.content,
      traceId: message.traceId,
      createdAt: Date.now(),
    };

    this.assertPeerAllowed(reply.to);
    await this.registry.deliver(reply);
  }

  private assertPeerAllowed(target: Address): void {
    const allowed = this.config.capabilities.some(
      (c) => c.kind === "peer" && c.address === target,
    );
    if (!allowed) throw new CapabilityError(this.address, target);
  }
}
