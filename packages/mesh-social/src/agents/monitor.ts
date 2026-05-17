import type { Address, Message, Peer, PeerRegistry } from "@corelay/mesh-core";
import type { PlatformAdapter, SocialEvent } from "../platforms/types.js";
import { SocialMonitor } from "../harvester/monitor.js";

export interface MonitorDeps {
  registry: PeerRegistry;
  adapters: PlatformAdapter[];
  keywords: string[];
  onError?: (err: unknown) => void;
}

export function createMonitorAgent(deps: MonitorDeps): Peer {
  const address = "social/monitor" as Address;
  const monitor = new SocialMonitor(deps.adapters);

  monitor.watch(deps.keywords, (event: SocialEvent) => {
    const message: Message = {
      id: crypto.randomUUID(),
      from: address,
      to: "campaign/intel" as Address,
      kind: "peer",
      content: JSON.stringify(event),
      traceId: crypto.randomUUID(),
      createdAt: Date.now(),
    };

    if (deps.registry.has(message.to)) {
      deps.registry.deliver(message).catch((err) => {
        if (deps.onError) deps.onError(err);
        else console.error(`[MonitorAgent] delivery failed:`, err instanceof Error ? err.message : err);
      });
    }
  });

  const peer: Peer = {
    address,
    async send(_message: Message): Promise<void> {
      // Monitor agent is event-driven, inbound messages not handled
    },
  };

  deps.registry.register(peer);
  return peer;
}
