import type { Address, Message } from "@corelay/mesh-core";

/**
 * A single parsed inbound WhatsApp event — one text message from one user.
 * Media, reactions, status updates etc. are ignored in Week 2 and surface
 * as an empty parse result.
 */
export interface ParsedInbound {
  /** The sender's E.164 phone number without `+`. */
  from: string;
  /** The text body. Empty string for non-text events. */
  text: string;
  /** Meta's message id, used as the durable Message id. */
  messageId: string;
  /** Phone number id the message was sent to, if present on the payload. */
  phoneNumberId?: string;
  /** Epoch millis of when Meta says the user sent it. */
  receivedAt: number;
}

/**
 * Parse a Meta Cloud API webhook body into zero or more ParsedInbound
 * events. Unknown shapes or non-messages return an empty array rather
 * than throwing — webhooks must ack 200, not crash.
 */
export const parseWebhookBody = (body: unknown): ParsedInbound[] => {
  const inbounds: ParsedInbound[] = [];
  if (!isRecord(body)) return inbounds;

  const entries = asArray(body.entry);
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const changes = asArray(entry.changes);
    for (const change of changes) {
      if (!isRecord(change)) continue;
      const value = change.value;
      if (!isRecord(value)) continue;

      const metadata = isRecord(value.metadata) ? value.metadata : undefined;
      const phoneNumberId = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : undefined;

      const messages = asArray(value.messages);
      for (const msg of messages) {
        if (!isRecord(msg)) continue;
        const parsed = parseSingle(msg, phoneNumberId);
        if (parsed) inbounds.push(parsed);
      }
    }
  }
  return inbounds;
};

/**
 * Build a mesh-core Message from a parsed inbound event.
 *
 * The `from` address is always `whatsapp/${phoneNumber}`. The `to` address
 * is whatever the caller wants to route this user's message to — typically
 * an agent address.
 */
export const toMessage = (
  inbound: ParsedInbound,
  toAgent: Address,
  traceId: string,
): Message => ({
  id: inbound.messageId,
  from: `whatsapp/${inbound.from}` as Address,
  to: toAgent,
  kind: "user",
  content: inbound.text,
  traceId,
  createdAt: inbound.receivedAt,
  metadata: inbound.phoneNumberId
    ? { whatsapp: { phoneNumberId: inbound.phoneNumberId } }
    : undefined,
});

// ─── helpers ──────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const parseSingle = (
  msg: Record<string, unknown>,
  phoneNumberId: string | undefined,
): ParsedInbound | null => {
  const from = typeof msg.from === "string" ? msg.from : null;
  const id = typeof msg.id === "string" ? msg.id : null;
  const timestamp = typeof msg.timestamp === "string" ? msg.timestamp : null;
  if (!from || !id) return null;

  // Only text messages for Week 2. Everything else (media, reactions,
  // status updates) returns null and the webhook handler still acks 200.
  const type = typeof msg.type === "string" ? msg.type : "";
  if (type !== "text") return null;

  const text = isRecord(msg.text) && typeof msg.text.body === "string" ? msg.text.body : "";
  if (!text) return null;

  const receivedAt = timestamp ? Number.parseInt(timestamp, 10) * 1000 : Date.now();

  return {
    from,
    text,
    messageId: id,
    ...(phoneNumberId !== undefined && { phoneNumberId }),
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
  };
};
