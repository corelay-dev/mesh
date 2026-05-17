import type { Browser, Page } from "playwright";
import type {
  PlatformAdapter,
  PostResult,
  EngagementMetrics,
  Reply,
  SocialEvent,
} from "./types.js";

export interface InstagramConfig {
  cookies?: string;
  accessToken?: string;
  igUserId?: string;
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

export class InstagramAdapter implements PlatformAdapter {
  private config: InstagramConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(config: InstagramConfig) {
    this.config = config;
  }

  async post(content: string, media?: Buffer[]): Promise<PostResult> {
    return withRetry(async () => {
      if (this.config.mode === "api" && this.config.accessToken && this.config.igUserId) {
        // Instagram Graph API requires media URL, not direct upload
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${this.config.igUserId}/media`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              caption: content,
              access_token: this.config.accessToken,
            }),
          },
        );
        if (!res.ok) throw new Error(`Instagram post failed: ${res.status}`);
        const data = (await res.json()) as { id: string };
        // Publish the container
        const pubRes = await fetch(
          `https://graph.facebook.com/v18.0/${this.config.igUserId}/media_publish`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              creation_id: data.id,
              access_token: this.config.accessToken,
            }),
          },
        );
        if (!pubRes.ok) throw new Error(`Instagram publish failed: ${pubRes.status}`);
        const pubData = (await pubRes.json()) as { id: string };
        return {
          postId: pubData.id,
          url: `https://instagram.com/p/${pubData.id}`,
          publishedAt: new Date(),
        };
      }

      const page = await this.getPage();
      await page.goto("https://www.instagram.com/");
      await page.waitForSelector('[aria-label="New post"]');
      await page.click('[aria-label="New post"]');

      if (media?.length) {
        const input = await page.waitForSelector('input[type="file"]');
        await input!.setInputFiles({ name: "media.png", mimeType: "image/png", buffer: media[0]! });
      }

      await page.waitForSelector('textarea[aria-label="Write a caption..."]');
      await page.fill('textarea[aria-label="Write a caption..."]', content);
      await page.click('button:has-text("Share")');
      await page.waitForTimeout(3000);

      const postId = crypto.randomUUID();
      return { postId, url: `https://instagram.com/p/${postId}`, publishedAt: new Date() };
    });
  }

  async getEngagement(postId: string): Promise<EngagementMetrics> {
    return withRetry(async () => {
      if (this.config.mode === "api" && this.config.accessToken) {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${postId}?fields=like_count,comments_count&access_token=${this.config.accessToken}`,
        );
        if (!res.ok) throw new Error(`Engagement fetch failed: ${res.status}`);
        const data = (await res.json()) as { like_count?: number; comments_count?: number };
        return {
          likes: data.like_count ?? 0,
          shares: 0,
          comments: data.comments_count ?? 0,
          impressions: 0,
          reach: 0,
        };
      }
      return { likes: 0, shares: 0, comments: 0, impressions: 0, reach: 0 };
    });
  }

  async getReplies(postId: string): Promise<Reply[]> {
    return withRetry(async () => {
      if (this.config.mode === "api" && this.config.accessToken) {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${postId}/comments?access_token=${this.config.accessToken}`,
        );
        if (!res.ok) throw new Error(`Replies fetch failed: ${res.status}`);
        const data = (await res.json()) as {
          data?: Array<{ id: string; username: string; text: string; timestamp: string }>;
        };
        return (data.data ?? []).map((c) => ({
          id: c.id,
          author: c.username,
          content: c.text,
          createdAt: new Date(c.timestamp),
        }));
      }
      return [];
    });
  }

  async *monitor(keywords: string[]): AsyncIterable<SocialEvent> {
    if (this.config.mode === "api" && this.config.accessToken && this.config.igUserId) {
      const res = await fetch(
        `https://graph.facebook.com/v18.0/${this.config.igUserId}/media?fields=id,caption,timestamp&access_token=${this.config.accessToken}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        data?: Array<{ id: string; caption?: string; timestamp: string }>;
      };
      for (const post of data.data ?? []) {
        if (keywords.some((k) => post.caption?.toLowerCase().includes(k.toLowerCase()))) {
          yield {
            id: post.id,
            platform: "instagram",
            type: "post",
            author: this.config.igUserId,
            content: post.caption ?? "",
            createdAt: new Date(post.timestamp),
          };
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.page) { await this.page.close(); this.page = null; }
    if (this.browser) { await this.browser.close(); this.browser = null; }
  }

  private async getPage(): Promise<Page> {
    if (!this.page) {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({ headless: true });
      const context = await this.browser.newContext();
      if (this.config.cookies) {
        const cookies = JSON.parse(this.config.cookies) as Array<{
          name: string; value: string; domain: string; path: string;
        }>;
        await context.addCookies(cookies);
      }
      this.page = await context.newPage();
    }
    return this.page;
  }
}
