import {
  handleWebhook,
  userPeer,
  WhatsAppClient,
} from "@corelay/mesh-channels-whatsapp";
import type { PeerRegistry, Address } from "@corelay/mesh-core";

export interface SimulatedInbound {
  /** The user's phone (E.164 without the leading +). */
  from: string;
  /** The message text. */
  text: string;
  /** Stable message id. Meta uses a "wamid.xxx" string. */
  messageId?: string;
}

export interface SimulatedHarness {
  /** Send an inbound message to the mesh as if Meta delivered a webhook. */
  inbound(event: SimulatedInbound): Promise<void>;
  /** Every simulated outbound delivery. Most recent last. */
  outbound: SimulatedOutbound[];
}

export interface SimulatedOutbound {
  to: string;
  text: string;
  at: number;
}

export interface BuildHarnessOptions {
  registry: PeerRegistry;
  /** Route inbounds to this address (the manager, usually). */
  routeTo: Address;
  /** Stable traceId for every inbound. Real use would derive per-conversation. */
  traceId?: string;
}

/**
 * In-memory harness that plays both sides of the WhatsApp conversation.
 *
 * - inbound() crafts a Meta-shaped webhook payload and calls handleWebhook,
 *   which parses it and delivers the Message into the supplied registry.
 *   handleWebhook also auto-registers a UserPeer for the sender's address
 *   — that UserPeer is the one the mesh delivers the final reply to.
 *
 * - outgoing replies from the mesh would normally hit Meta's /messages
 *   endpoint via fetch. We stub fetch to capture the call instead and
 *   record it on `outbound` so the caller can print/assert it.
 */
export const buildSimulatedHarness = (options: BuildHarnessOptions): SimulatedHarness => {
  const outbound: SimulatedOutbound[] = [];

  const stubFetch: typeof globalThis.fetch = async (url, init) => {
    const opts = (init ?? {}) as RequestInit;
    const body = JSON.parse(String(opts.body ?? "{}")) as {
      to?: string;
      text?: { body?: string };
    };
    outbound.push({
      to: body.to ?? "unknown",
      text: body.text?.body ?? "",
      at: Date.now(),
    });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const whatsAppClient = new WhatsAppClient({
    accessToken: "SIMULATED_TOKEN",
    defaultPhoneNumberId: "SIMULATED_PNID",
    fetchImpl: stubFetch,
  });

  return {
    outbound,
    async inbound(event) {
      const messageId = event.messageId ?? `wamid.sim-${outbound.length}-${Date.now()}`;
      const body = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "+442012345678",
                    phone_number_id: "SIMULATED_PNID",
                  },
                  contacts: [{ wa_id: event.from }],
                  messages: [
                    {
                      from: event.from,
                      id: messageId,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body: event.text },
                    },
                  ],
                },
                field: "messages",
              },
            ],
          },
        ],
      };

      await handleWebhook(
        {
          verifyToken: "SIMULATED_VERIFY",
          registry: options.registry,
          outboundClient: whatsAppClient,
          routeTo: options.routeTo,
          ...(options.traceId !== undefined && { makeTraceId: () => options.traceId! }),
        },
        { method: "POST", body },
      );
    },
  };
};

/** Eagerly register a UserPeer for one phone. Useful if you want to pre-wire. */
export const registerUserPeer = (
  registry: PeerRegistry,
  phone: string,
  client: WhatsAppClient,
): void => {
  const address = `whatsapp/${phone}` as Address;
  if (!registry.has(address)) {
    registry.register(userPeer({ address, client }));
  }
};
