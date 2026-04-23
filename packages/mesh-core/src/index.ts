export { type Address, parseAddress } from "./address.js";
export { type Message, type MessageKind } from "./message.js";
export { type Peer } from "./peer.js";
export { type Inbox, type MessageHandler } from "./inbox.js";
export {
  type Capability,
  type ToolCapability,
  type PeerCapability,
  type ChannelCapability,
  type ChannelName,
} from "./capability.js";

export const version = "0.0.1";
