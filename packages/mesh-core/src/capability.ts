import type { Address } from "./address.js";

/**
 * A Capability is an explicit, auditable grant that lets an Agent do one
 * specific thing. Agents cannot call tools or address peers outside their
 * declared capabilities — the runtime enforces this.
 *
 * Three kinds:
 *   - `tool`    — permission to call a named tool.
 *   - `peer`    — permission to send messages to a specific peer address.
 *   - `channel` — permission to emit to an outbound channel.
 *
 * Why explicit capabilities instead of implicit access: they make tool
 * exfiltration and peer-confusion attacks much harder, and they produce a
 * clear audit log — "who could have done what" — without inference.
 */
export type Capability =
  | ToolCapability
  | PeerCapability
  | ChannelCapability;

export interface ToolCapability {
  kind: "tool";
  name: string;
}

export interface PeerCapability {
  kind: "peer";
  address: Address;
}

export interface ChannelCapability {
  kind: "channel";
  name: ChannelName;
}

export type ChannelName =
  | "web"
  | "whatsapp"
  | "ussd"
  | "sms"
  | "slack"
  | "email";
