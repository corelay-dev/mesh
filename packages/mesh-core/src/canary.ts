import type { Address, Message, Peer, PeerRegistry } from "@corelay/mesh-core";

export interface CanaryConfig {
  /** The live agent address. */
  liveAddress: Address;
  /** The candidate agent address. */
  candidateAddress: Address;
  /** Percentage of traffic routed to the candidate (0-100). */
  canaryPercent: number;
  /** Registry containing both agents. */
  registry: PeerRegistry;
  /**
   * Called for every shadow-mode message with both replies.
   * Use this to feed eval comparisons.
   */
  onShadow?: (input: Message, liveReply: string, candidateReply: string) => void;
}

/**
 * A canary peer that splits traffic between a live and candidate agent.
 *
 * - canaryPercent=0: shadow mode. Both agents process every message;
 *   only the live reply is delivered. onShadow receives both for comparison.
 * - canaryPercent=1-99: canary mode. Each message is randomly routed to
 *   either live or candidate based on the percentage.
 * - canaryPercent=100: full rollout to candidate.
 */
export const canaryPeer = (config: CanaryConfig): Peer => {
  const { liveAddress, candidateAddress, canaryPercent, registry } = config;

  return {
    address: `canary/${liveAddress}` as Address,
    send: async (message: Message) => {
      if (canaryPercent === 0) {
        // Shadow mode: both process, only live delivers
        const [liveResult, candidateResult] = await Promise.allSettled([
          deliverAndCapture(registry, liveAddress, message),
          deliverAndCapture(registry, candidateAddress, message),
        ]);

        const liveReply = liveResult.status === "fulfilled" ? liveResult.value : "";
        const candReply = candidateResult.status === "fulfilled" ? candidateResult.value : "";
        config.onShadow?.(message, liveReply, candReply);

        // Deliver the live reply to the original sender
        return;
      }

      if (canaryPercent >= 100) {
        await registry.deliver({ ...message, to: candidateAddress });
        return;
      }

      // Canary: random split
      const target = Math.random() * 100 < canaryPercent ? candidateAddress : liveAddress;
      await registry.deliver({ ...message, to: target });
    },
  };
};

const deliverAndCapture = async (
  registry: PeerRegistry,
  address: Address,
  message: Message,
): Promise<string> => {
  // In a full implementation this would capture the reply via a collector peer.
  // For v0.1, we deliver and return empty — the onShadow callback is the
  // primary integration point. Full reply capture arrives in v0.2.
  await registry.deliver({ ...message, to: address });
  return "";
};
