import type { Address, Message, Peer, PeerRegistry } from "@corelay/mesh-core";

export interface SmsClientConfig {
  /** Twilio Account SID or equivalent. */
  accountSid: string;
  /** Twilio Auth Token or equivalent. */
  authToken: string;
  /** The phone number messages are sent from. E.164 format. */
  fromNumber: string;
  /** Optional: custom API endpoint (for testing). */
  apiUrl?: string;
}

export interface SmsClient {
  send(to: string, body: string): Promise<void>;
}

export const createSmsClient = (config: SmsClientConfig): SmsClient => ({
  send: async (to, body) => {
    const url = config.apiUrl ?? `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
    const params = new URLSearchParams({ To: to, From: config.fromNumber, Body: body });
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`SMS send failed: ${res.status} ${await res.text()}`);
  },
});

export interface SmsInboundMessage {
  from: string;
  body: string;
  messageSid?: string;
}

export const parseInbound = (body: Record<string, string>): SmsInboundMessage | undefined => {
  const from = body.From;
  const text = body.Body;
  if (!from || !text) return undefined;
  return { from, body: text, messageSid: body.MessageSid };
};

export const smsUserPeer = (
  phoneNumber: string,
  client: SmsClient,
): Peer => ({
  address: `sms/${phoneNumber.replace(/\+/g, "")}` as Address,
  send: async (message: Message) => {
    await client.send(phoneNumber, message.content);
  },
});
