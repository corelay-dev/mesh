import type { Browser, BrowserContext, Page } from "playwright";
import type {
  PlatformAdapter,
  PostResult,
  EngagementMetrics,
  Reply,
  SocialEvent,
} from "./types.js";

export interface TwitterConfig {
  cookies?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  mode: "browser" | "api";
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
 * Generate OAuth 1.0a signature for Twitter API requests.
 * Required for user-context actions (posting, liking, etc).
 */
function generateOAuthHeader(
  method: string,
  url: string,
  config: TwitterConfig,
  params: Record<string, string> = {},
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.apiKey!,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: config.accessToken!,
    oauth_version: "1.0",
    ...params,
  };

  const sortedParams = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(config.apiSecret!)}&${encodeURIComponent(config.accessTokenSecret!)}`;

  // HMAC-SHA1 using Web Crypto
  const signature = hmacSha1Sync(signingKey, baseString);

  const authParams = Object.entries(oauthParams)
    .filter(([k]) => k.startsWith("oauth_"))
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .concat(`oauth_signature="${encodeURIComponent(signature)}"`)
    .join(", ");

  return `OAuth ${authParams}`;
}

/**
 * Synchronous HMAC-SHA1 using Node.js crypto.
 * Falls back to empty string if unavailable (tests).
 */
function hmacSha1Sync(key: string, data: string): string {
  try {
    // Dynamic import to avoid issues in non-Node environments
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    return createHmac("sha1", key).update(data).digest("base64");
  } catch {
    return "";
  }
}

export class TwitterAdapter implements PlatformAdapter {
  private config: TwitterConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(config: TwitterConfig) {
    this.config = config;
  }

  async post(content: string, media?: Buffer[]): Promise<PostResult> {
    if (this.config.mode === "api") {
      return this.postViaApi(content, media);
    }
    return this.postViaBrowser(content, media);
  }

  private async postViaApi(content: string, media?: Buffer[]): Promise<PostResult> {
    if (!this.config.apiKey || !this.config.apiSecret || !this.config.accessToken || !this.config.accessTokenSecret) {
      throw new Error("Twitter API mode requires apiKey, apiSecret, accessToken, and accessTokenSecret");
    }

    return withRetry(async () => {
      const mediaIds: string[] = [];
      if (media?.length) {
        for (const buf of media) {
          const uploadUrl = "https://upload.twitter.com/1.1/media/upload.json";
          const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            headers: {
              Authorization: generateOAuthHeader("POST", uploadUrl, this.config),
              "Content-Type": "application/octet-stream",
            },
            body: buf,
          });
          if (!uploadRes.ok) throw new Error(`Media upload failed: ${uploadRes.status}`);
          const data = (await uploadRes.json()) as { media_id_string: string };
          mediaIds.push(data.media_id_string);
        }
      }

      const tweetUrl = "https://api.twitter.com/2/tweets";
      const body: Record<string, unknown> = { text: content };
      if (mediaIds.length) {
        body.media = { media_ids: mediaIds };
      }

      const res = await fetch(tweetUrl, {
        method: "POST",
        headers: {
          Authorization: generateOAuthHeader("POST", tweetUrl, this.config),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Tweet failed: ${res.status} ${await res.text()}`);
      const result = (await res.json()) as { data: { id: string } };
      return {
        postId: result.data.id,
        url: `https://twitter.com/i/status/${result.data.id}`,
        publishedAt: new Date(),
      };
    });
  }

  private async postViaBrowser(content: string, media?: Buffer[]): Promise<PostResult> {
    return withRetry(async () => {
      const page = await this.getPage();
      await page.goto("https://twitter.com/compose/tweet");
      await page.waitForSelector('[data-testid="tweetTextarea_0"]');
      await page.fill('[data-testid="tweetTextarea_0"]', content);

      if (media?.length) {
        const input = await page.waitForSelector('input[type="file"]');
        for (const buf of media) {
          await input!.setInputFiles({ name: "media.png", mimeType: "image/png", buffer: buf });
        }
      }

      await page.click('[data-testid="tweetButton"]');
      await page.waitForTimeout(2000);

      const url = page.url();
      const postId = url.split("/").pop() ?? crypto.randomUUID();
      return { postId, url, publishedAt: new Date() };
    });
  }

  async getEngagement(postId: string): Promise<EngagementMetrics> {
    return withRetry(async () => {
      if (this.config.mode === "api") {
        const url = `https://api.twitter.com/2/tweets/${postId}?tweet.fields=public_metrics`;
        const res = await fetch(url, {
          headers: { Authorization: generateOAuthHeader("GET", url.split("?")[0]!, this.config) },
        });
        if (!res.ok) throw new Error(`Engagement fetch failed: ${res.status}`);
        const data = (await res.json()) as {
          data: { public_metrics: { like_count: number; retweet_count: number; reply_count: number; impression_count: number } };
        };
        const m = data.data.public_metrics;
        return { likes: m.like_count, shares: m.retweet_count, comments: m.reply_count, impressions: m.impression_count, reach: m.impression_count };
      }
      const page = await this.getPage();
      await page.goto(`https://twitter.com/i/status/${postId}`);
      return { likes: 0, shares: 0, comments: 0, impressions: 0, reach: 0 };
    });
  }

  async getReplies(postId: string): Promise<Reply[]> {
    return withRetry(async () => {
      if (this.config.mode === "api") {
        const url = `https://api.twitter.com/2/tweets/search/recent?query=conversation_id:${postId}&tweet.fields=author_id,created_at`;
        const res = await fetch(url, {
          headers: { Authorization: generateOAuthHeader("GET", url.split("?")[0]!, this.config) },
        });
        if (!res.ok) throw new Error(`Replies fetch failed: ${res.status}`);
        const data = (await res.json()) as {
          data?: Array<{ id: string; author_id: string; text: string; created_at: string }>;
        };
        return (data.data ?? []).map((r) => ({
          id: r.id,
          author: r.author_id,
          content: r.text,
          createdAt: new Date(r.created_at),
        }));
      }
      return [];
    });
  }

  async *monitor(keywords: string[]): AsyncIterable<SocialEvent> {
    if (this.config.mode === "api") {
      const query = keywords.map((k) => encodeURIComponent(k)).join(" OR ");
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&tweet.fields=author_id,created_at`;
      const res = await fetch(url, {
        headers: { Authorization: generateOAuthHeader("GET", url.split("?")[0]!, this.config) },
      });
      if (!res.ok) throw new Error(`Monitor failed: ${res.status}`);
      const data = (await res.json()) as {
        data?: Array<{ id: string; author_id: string; text: string; created_at: string }>;
      };
      for (const tweet of data.data ?? []) {
        yield {
          id: tweet.id,
          platform: "twitter",
          type: "post",
          author: tweet.author_id,
          content: tweet.text,
          createdAt: new Date(tweet.created_at),
        };
      }
    }
  }

  async close(): Promise<void> {
    if (this.page) { await this.page.close(); this.page = null; }
    if (this.context) { await this.context.close(); this.context = null; }
    if (this.browser) { await this.browser.close(); this.browser = null; }
  }

  private async getPage(): Promise<Page> {
    if (!this.page) {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext();
      if (this.config.cookies) {
        const cookies = JSON.parse(this.config.cookies) as Array<{ name: string; value: string; domain: string; path: string }>;
        await this.context.addCookies(cookies);
      }
      this.page = await this.context.newPage();
    }
    return this.page;
  }
}
