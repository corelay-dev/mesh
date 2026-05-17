import type {
  PlatformAdapter,
  PostResult,
  EngagementMetrics,
  Reply,
  SocialEvent,
} from "./types.js";

export interface WhatsAppStatusConfig {
  apiUrl: string;
  apiToken: string;
  phoneNumberId: string;
}

const MAX_RETRIES = 3;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error("Unreachable");
}

/**
 * WhatsApp Status adapter — posts to WhatsApp Status (Stories) via the
 * WhatsApp Business API. This is the #1 "social media" channel in Nigeria.
 *
 * Uses the WhatsApp Business Cloud API status_updates endpoint.
 */
export class WhatsAppStatusAdapter implements PlatformAdapter {
  private config: WhatsAppStatusConfig;

  constructor(config: WhatsAppStatusConfig) {
    this.config = config;
  }

  async post(content: string, media?: Buffer[]): Promise<PostResult> {
    return withRetry(async () => {
      if (media?.length) {
        // Upload media first, then post as image status
        const mediaId = await this.uploadMedia(media[0]!);
        return this.postMediaStatus(mediaId, content);
      }
      return this.postTextStatus(content);
    });
  }

  private async postTextStatus(content: string): Promise<PostResult> {
    const res = await fetch(
      `${this.config.apiUrl}/${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          type: "text",
          status: "posted",
          text: { body: content },
          recipient_type: "status",
        }),
      },
    );

    if (!res.ok) throw new Error(`WhatsApp Status post failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { messages: Array<{ id: string }> };
    const messageId = data.messages[0]?.id ?? crypto.randomUUID();

    return {
      postId: messageId,
      url: `whatsapp://status/${messageId}`,
      publishedAt: new Date(),
    };
  }

  private async postMediaStatus(mediaId: string, caption: string): Promise<PostResult> {
    const res = await fetch(
      `${this.config.apiUrl}/${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          type: "image",
          status: "posted",
          image: { id: mediaId, caption },
          recipient_type: "status",
        }),
      },
    );

    if (!res.ok) throw new Error(`WhatsApp Status media post failed: ${res.status}`);
    const data = (await res.json()) as { messages: Array<{ id: string }> };
    const messageId = data.messages[0]?.id ?? crypto.randomUUID();

    return {
      postId: messageId,
      url: `whatsapp://status/${messageId}`,
      publishedAt: new Date(),
    };
  }

  private async uploadMedia(buffer: Buffer): Promise<string> {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("type", "image/png");
    formData.append("file", new Blob([new Uint8Array(buffer)], { type: "image/png" }), "status.png");

    const res = await fetch(
      `${this.config.apiUrl}/${this.config.phoneNumberId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        body: formData,
      },
    );

    if (!res.ok) throw new Error(`Media upload failed: ${res.status}`);
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async getEngagement(_postId: string): Promise<EngagementMetrics> {
    // WhatsApp Status doesn't expose public engagement metrics via API
    // Views are available but not likes/shares
    return { likes: 0, shares: 0, comments: 0, impressions: 0, reach: 0 };
  }

  async getReplies(_postId: string): Promise<Reply[]> {
    // Status replies come as inbound messages — handled by webhook, not polling
    return [];
  }

  async *monitor(_keywords: string[]): AsyncIterable<SocialEvent> {
    // WhatsApp Status doesn't support keyword monitoring
    // Inbound messages are handled via webhook in the app layer
  }

  async close(): Promise<void> {
    // No persistent connections to clean up
  }
}
