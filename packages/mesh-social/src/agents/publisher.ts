import type { Address, Message, Peer, PeerRegistry } from "@corelay/mesh-core";
import type { PlatformAdapter, PostResult } from "../platforms/types.js";

export interface PublisherDeps {
  registry: PeerRegistry;
  adapters: Map<string, PlatformAdapter>;
}

interface PublishRequest {
  content: string;
  platform: string;
  media?: string[]; // base64 encoded
}

export function createPublisherAgent(deps: PublisherDeps): Peer {
  const address = "social/publisher" as Address;

  const peer: Peer = {
    address,
    async send(message: Message): Promise<void> {
      const request = JSON.parse(message.content) as PublishRequest;
      const adapter = deps.adapters.get(request.platform);
      if (!adapter) throw new Error(`No adapter for platform: ${request.platform}`);

      const media = request.media?.map((b64) => Buffer.from(b64, "base64"));
      const result: PostResult = await adapter.post(request.content, media);

      const reply: Message = {
        id: crypto.randomUUID(),
        from: address,
        to: message.from,
        kind: "peer",
        content: JSON.stringify({ postId: result.postId, url: result.url }),
        traceId: message.traceId,
        createdAt: Date.now(),
      };

      await deps.registry.deliver(reply);
    },
  };

  deps.registry.register(peer);
  return peer;
}
