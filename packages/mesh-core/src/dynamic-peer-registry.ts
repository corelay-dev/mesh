import type { Address } from "./address.js";
import type { AgentConfig } from "./agent-config.js";
import type { Inbox } from "./inbox.js";
import type { LLMClient } from "./llm.js";
import type { Peer } from "./peer.js";
import type { Message } from "./message.js";
import { Agent, type AgentOptions } from "./agent.js";
import { MemoryInbox } from "./memory-inbox.js";

export type PeerEvent =
  | { kind: "registered"; address: Address; peer: Peer }
  | { kind: "unregistered"; address: Address };

export type PeerEventListener = (event: PeerEvent) => void;

/**
 * Extension of PeerRegistry that emits events on registration changes
 * and supports runtime discovery via `list()`.
 */
export class DynamicPeerRegistry {
  private readonly peers = new Map<Address, Peer>();
  private readonly listeners = new Set<PeerEventListener>();

  register(peer: Peer): void {
    this.peers.set(peer.address, peer);
    this.emit({ kind: "registered", address: peer.address, peer });
  }

  unregister(address: Address): boolean {
    const existed = this.peers.delete(address);
    if (existed) {
      this.emit({ kind: "unregistered", address });
    }
    return existed;
  }

  get(address: Address): Peer | undefined {
    return this.peers.get(address);
  }

  has(address: Address): boolean {
    return this.peers.has(address);
  }

  /** List all registered peer addresses. */
  list(): Address[] {
    return [...this.peers.keys()];
  }

  /** Number of registered peers. */
  get size(): number {
    return this.peers.size;
  }

  async deliver(message: Message): Promise<void> {
    const peer = this.peers.get(message.to);
    if (!peer) {
      throw new DynamicPeerNotFoundError(message.to);
    }
    await peer.send(message);
  }

  /** Subscribe to registration/unregistration events. Returns unsubscribe fn. */
  onPeerChange(listener: PeerEventListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: PeerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export class DynamicPeerNotFoundError extends Error {
  constructor(public readonly address: Address) {
    super(`Dynamic peer not found: ${address}`);
    this.name = "DynamicPeerNotFoundError";
  }
}

export interface SpawnPeerOptions {
  config: AgentConfig;
  llm: LLMClient;
  agentOptions?: AgentOptions;
  /** Custom inbox. Defaults to MemoryInbox. */
  inbox?: Inbox;
}

/**
 * Spawn a new Agent as a peer at runtime and register it in the given registry.
 * Returns the spawned Agent (already started and registered).
 */
export async function spawnPeer(
  registry: DynamicPeerRegistry,
  address: Address,
  options: SpawnPeerOptions,
): Promise<Agent> {
  const inbox = options.inbox ?? new MemoryInbox();

  // The Agent constructor requires a PeerRegistry with deliver().
  // We create a thin adapter that delegates to the DynamicPeerRegistry.
  const registryAdapter = {
    deliver: (msg: Message) => registry.deliver(msg),
  };

  const agent = new Agent(
    address,
    options.config,
    options.llm,
    inbox,
    registryAdapter as never, // PeerRegistry duck-type compatible
    options.agentOptions ?? {},
  );

  registry.register(agent);
  await agent.start();

  return agent;
}
