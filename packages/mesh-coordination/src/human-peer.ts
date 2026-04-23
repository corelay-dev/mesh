import type {
  Address,
  Inbox,
  Message,
  Peer,
  PeerRegistry,
} from "@corelay/mesh-core";

export type HumanDecision = "approve" | "reject" | "edit" | "reassign";

export interface HumanAction {
  decision: HumanDecision;
  /**
   * For `edit`: the edited content to send in place of the original.
   * For `reject`: the reason, surfaced to the caller.
   * For `reassign`: the new target address.
   * For `approve`: optional extra note the caller may record.
   */
  content?: string;
  /** Target address for `reassign`. */
  reassignTo?: Address;
  /** Who acted, for audit. */
  actor?: string;
}

export interface PendingItem {
  /** The worklist item id. Returned when the item was enqueued. */
  id: string;
  /** The message awaiting human attention. */
  message: Message;
  /** Epoch millis when it entered the worklist. */
  receivedAt: number;
}

export interface HumanPeerConfig {
  /** The human peer's address — e.g. `safevoice/caseworker/alice`. */
  address: Address;
  /** Durable inbox persisting the worklist. In-memory or Postgres. */
  inbox: Inbox;
  /** Registry used to deliver responses back to the caller. */
  registry: PeerRegistry;
}

/**
 * A Human as a Peer.
 *
 * When a message arrives, it is stored in the human's durable worklist and
 * the workflow is effectively suspended — no in-process wait, just a
 * message sitting in an inbox that hasn't been consumed yet.
 *
 * A real human (via an API, UI, or WhatsApp reply) later calls `respond()`
 * with a decision. The HumanPeer builds a reply Message and delivers it
 * back to the original sender via the registry, resuming the flow.
 *
 * Decisions:
 *   - approve   → deliver the original message content, unchanged, to the
 *                 caller
 *   - reject    → deliver a rejection reason to the caller (caller decides
 *                 whether to escalate)
 *   - edit      → deliver `action.content` (edited by the human) to the
 *                 caller
 *   - reassign  → deliver the original message to a different address
 *                 entirely (`action.reassignTo`)
 */
export class HumanPeer implements Peer {
  readonly address: Address;
  private readonly inbox: Inbox;
  private readonly registry: PeerRegistry;
  private readonly pending = new Map<string, PendingItem>();

  constructor(config: HumanPeerConfig) {
    this.address = config.address;
    this.inbox = config.inbox;
    this.registry = config.registry;
  }

  /**
   * Start consuming the durable inbox into the in-memory pending list.
   * Call once at startup.
   */
  async start(): Promise<void> {
    await this.inbox.consume(async (message) => {
      this.pending.set(message.id, {
        id: message.id,
        message,
        receivedAt: Date.now(),
      });
    });
  }

  /** Peer.send — append to the durable inbox. */
  async send(message: Message): Promise<void> {
    await this.inbox.append(message);
  }

  /** Enumerate items awaiting human attention. Ordered by arrival time. */
  list(): PendingItem[] {
    return [...this.pending.values()].sort((a, b) => a.receivedAt - b.receivedAt);
  }

  /**
   * Record a human's decision on one pending item and deliver the resulting
   * reply message to the original sender. Throws if the item is unknown.
   */
  async respond(itemId: string, action: HumanAction): Promise<void> {
    const item = this.pending.get(itemId);
    if (!item) {
      throw new Error(`HumanPeer ${this.address}: no pending item with id "${itemId}"`);
    }

    const reply = this.buildReply(item.message, action);
    this.pending.delete(itemId);
    await this.registry.deliver(reply);
  }

  private buildReply(original: Message, action: HumanAction): Message {
    const base: Omit<Message, "to" | "content"> = {
      id: `${original.id}-human-${action.decision}`,
      from: this.address,
      kind: "peer",
      traceId: original.traceId,
      createdAt: Date.now(),
      metadata: {
        ...(original.metadata ?? {}),
        human: {
          decision: action.decision,
          ...(action.actor !== undefined && { actor: action.actor }),
          ...(action.content !== undefined && { note: action.content }),
        },
      },
    };

    switch (action.decision) {
      case "approve":
        return { ...base, to: original.from, content: original.content };
      case "reject":
        return {
          ...base,
          to: original.from,
          content: action.content ?? "Rejected by human reviewer.",
        };
      case "edit":
        if (action.content === undefined) {
          throw new Error(`HumanPeer ${this.address}: 'edit' requires action.content`);
        }
        return { ...base, to: original.from, content: action.content };
      case "reassign":
        if (action.reassignTo === undefined) {
          throw new Error(`HumanPeer ${this.address}: 'reassign' requires action.reassignTo`);
        }
        return { ...base, to: action.reassignTo, content: original.content };
    }
  }
}
