import type { Address, Message, Peer, PeerRegistry } from "@corelay/mesh-core";

export interface SlackClientConfig {
  /** Bot OAuth token (xoxb-...). */
  botToken: string;
  /** Optional: custom API endpoint (for testing). */
  apiUrl?: string;
}

export interface SlackClient {
  postMessage(channel: string, text: string): Promise<void>;
}

export const createSlackClient = (config: SlackClientConfig): SlackClient => ({
  postMessage: async (channel, text) => {
    const url = config.apiUrl ?? "https://slack.com/api/chat.postMessage";
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });
    if (!res.ok) throw new Error(`Slack send failed: ${res.status}`);
    const data = await res.json() as { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  },
});

export interface SlackEvent {
  type: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
}

export const parseSlackEvent = (body: Record<string, unknown>): SlackEvent | undefined => {
  const event = body.event as Record<string, unknown> | undefined;
  if (!event || typeof event.type !== "string") return undefined;
  return {
    type: event.type as string,
    channel: event.channel as string | undefined,
    user: event.user as string | undefined,
    text: event.text as string | undefined,
    ts: event.ts as string | undefined,
  };
};

export const slackUserPeer = (
  channelId: string,
  client: SlackClient,
): Peer => ({
  address: `slack/${channelId}` as Address,
  send: async (message: Message) => {
    await client.postMessage(channelId, message.content);
  },
});
