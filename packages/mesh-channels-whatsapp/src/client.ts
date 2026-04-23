import type { Address, Message, Peer } from "@corelay/mesh-core";

export interface WhatsAppClientConfig {
  /**
   * Meta Cloud API bearer token. Used as `Authorization: Bearer <token>`.
   */
  accessToken: string;
  /**
   * The WhatsApp Business phone number id messages are sent *from*.
   * If the inbound message carried its own phoneNumberId in metadata,
   * it overrides this per-message.
   */
  defaultPhoneNumberId: string;
  /**
   * Meta Graph API version. Defaults to "v21.0".
   */
  graphVersion?: string;
  /**
   * fetch implementation. Default: globalThis.fetch. Injectable so tests
   * can stub without touching the network.
   */
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * Thin client over the Meta Cloud API `/messages` endpoint.
 *
 * Sends plain-text WhatsApp messages. Template and media sends are out
 * of scope for Week 2; they can be added without changing the Peer
 * interface when a product needs them.
 */
export class WhatsAppClient {
  private readonly config: WhatsAppClientConfig;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: WhatsAppClientConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async sendText(params: {
    to: string;
    text: string;
    phoneNumberId?: string;
  }): Promise<void> {
    const phoneNumberId = params.phoneNumberId ?? this.config.defaultPhoneNumberId;
    const url = `https://graph.facebook.com/${this.config.graphVersion ?? "v21.0"}/${phoneNumberId}/messages`;

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "text",
        text: { body: params.text },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `WhatsApp send failed: ${response.status} ${response.statusText} ${text}`,
      );
    }
  }
}

export interface UserPeerConfig {
  /** The user's full address, e.g. `whatsapp/447911123456`. */
  address: Address;
  /** The client used to actually dispatch the API call. */
  client: WhatsAppClient;
}

/**
 * Outbound peer representing one WhatsApp user. Every WhatsApp user the
 * system can reply to is registered as a UserPeer; sending a message to
 * that address dispatches a WhatsApp API call.
 *
 * Typically created on-demand by the webhook handler when an inbound
 * arrives — the handler sees the user's number, registers a UserPeer
 * for that address (if not already registered), then delivers the
 * inbound Message into the registry.
 */
export const userPeer = (config: UserPeerConfig): Peer => {
  const phoneNumber = extractPhoneNumber(config.address);
  return {
    address: config.address,
    async send(message: Message) {
      const override = (message.metadata?.whatsapp as { phoneNumberId?: string } | undefined)?.phoneNumberId;
      await config.client.sendText({
        to: phoneNumber,
        text: message.content,
        ...(override !== undefined && { phoneNumberId: override }),
      });
    },
  };
};

const extractPhoneNumber = (address: Address): string => {
  const parts = address.split("/");
  if (parts.length < 2 || parts[0] !== "whatsapp") {
    throw new Error(
      `userPeer: expected 'whatsapp/<phone>' address, got "${address}"`,
    );
  }
  return parts[1] ?? "";
};
