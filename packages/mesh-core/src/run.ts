import type { Address } from "./address.js";
import type { Message, MessageKind } from "./message.js";
import type { Peer } from "./peer.js";
import type { PeerRegistry } from "./peer-registry.js";

export interface RunOptions {
  /** Override the ephemeral caller address. Useful for channel-driven flows. */
  from?: Address;
  /** Trace id for the workflow. Generated if omitted. */
  traceId?: string;
  /** Message id for the initial inbound message. Generated if omitted. */
  messageId?: string;
  /** How long to wait for a reply before rejecting. Default 30s. */
  timeoutMs?: number;
  /** Kind of the inbound message. Default "user". */
  kind?: MessageKind;
}

export interface RunResult {
  content: string;
  traceId: string;
}

/**
 * Convenience helper for the common case: send one user message to a root
 * Peer, await the first reply back.
 *
 * Under the hood: registers a one-shot ephemeral Peer to receive the reply,
 * sends the initial message via the registry, resolves on first delivery,
 * rejects on timeout.
 *
 * Not the production entry point — channels (WhatsApp, USSD, Web) drive
 * agents directly. This is for examples, tests, and single-call scripts.
 */
export const run = async (
  registry: PeerRegistry,
  rootAddress: Address,
  userMessage: string,
  options: RunOptions = {},
): Promise<RunResult> => {
  const traceId = options.traceId ?? crypto.randomUUID();
  const messageId = options.messageId ?? crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const callerAddress = options.from ?? (`ephemeral/${crypto.randomUUID()}` as Address);

  let resolve: (r: RunResult) => void;
  let reject: (e: Error) => void;
  const replyPromise = new Promise<RunResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const caller: Peer = {
    address: callerAddress,
    async send(message) {
      resolve({ content: message.content, traceId: message.traceId });
    },
  };
  registry.register(caller);

  const timer = setTimeout(() => {
    registry.unregister(callerAddress);
    reject(new Error(`run() timed out after ${timeoutMs}ms waiting for ${rootAddress}`));
  }, timeoutMs);

  const initial: Message = {
    id: messageId,
    from: callerAddress,
    to: rootAddress,
    kind: options.kind ?? "user",
    content: userMessage,
    traceId,
    createdAt: Date.now(),
  };

  try {
    await registry.deliver(initial);
    const result = await replyPromise;
    return result;
  } finally {
    clearTimeout(timer);
    registry.unregister(callerAddress);
  }
};
