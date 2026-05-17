import type { Browser, Page } from "playwright";
import type {
  PlatformAdapter,
  PostResult,
  EngagementMetrics,
  Reply,
  SocialEvent,
} from "./types.js";

export interface FacebookConfig {
  cookies?: string;
  accessToken?: string;
  pageId?: string;
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

export class FacebookAdapter implements PlatformAdapter {
  private config: FacebookConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(config: FacebookConfig) {
    this.config = config;
  }

  async post(content: string, media?: Buffer[]): Promise<PostResult> {
    return withRetry(async () => {
      if (this.config.mode === "api" && this.config.accessToken && this.config.pageId) {
        const body: Record<string, unknown> = { message: content, access_token: this.config.accessToken };
        const res = await fetch(`https://graph.facebook.com/v18.0/${this.config.pageId}/feed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Facebook post failed: ${res.status}`);
        const data = (await res.json()) as { id: string };
        return {
          postId: data.id,
          url: `https://facebook.com/${data.id}`,
          publishedAt: new Date(),
        };
      }

      const page = await this.getPage();
      await page.goto("https://www.facebook.com/");
      await page.waitForSelector('[aria-label="Create a post"]');
      await page.click('[aria-label="Create a post"]');
      await page.waitForSelector('[aria-label="What\'s on your mind?"]');
      await page.fill('[aria-label="What\'s on your mind?"]', content);

      if (media?.length) {
        const input = await page.waitForSelector('input[type="file"]');
        for (const buf of media) {
          await input!.setInputFiles({ name: "media.png", mimeType: "image/png", buffer: buf });
        }
      }

      await page.click('[aria-label="Post"]');
      await page.waitForTimeout(3000);
      const postId = crypto.randomUUID();
      return { postId, url: `https://facebook.com/${postId}`, publishedAt: new Date() };
    });
  }

  async getEngagement(postId: string): Promise<EngagementMetrics> {
    return withRetry(async () => {
      if (this.config.mode === "api" && this.config.accessToken) {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${postId}?fields=likes.summary(true),shares,comments.summary(true)&access_token=${this.config.accessToken}`,
        );
        if (!res.ok) throw new Error(`Engagement fetch failed: ${res.status}`);
        const data = (await res.json()) as {
          likes?: { summary: { total_count: number } };
          shares?: { count: number };
          comments?: { summary: { total_count: number } };
        };
        return {
          likes: data.likes?.summary.total_count ?? 0,
          shares: data.shares?.count ?? 0,
          comments: data.comments?.summary.total_count ?? 0,
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
          data?: Array<{ id: string; from: { name: string }; message: string; created_time: string }>;
        };
        return (data.data ?? []).map((c) => ({
          id: c.id,
          author: c.from.name,
          content: c.message,
          createdAt: new Date(c.created_time),
        }));
      }
      return [];
    });
  }

  async *monitor(keywords: string[]): AsyncIterable<SocialEvent> {
    if (this.config.mode === "api" && this.config.accessToken && this.config.pageId) {
      const res = await fetch(
        `https://graph.facebook.com/v18.0/${this.config.pageId}/feed?access_token=${this.config.accessToken}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        data?: Array<{ id: string; from: { name: string }; message?: string; created_time: string }>;
      };
      for (const post of data.data ?? []) {
        if (keywords.some((k) => post.message?.toLowerCase().includes(k.toLowerCase()))) {
          yield {
            id: post.id,
            platform: "facebook",
            type: "post",
            author: post.from.name,
            content: post.message ?? "",
            createdAt: new Date(post.created_time),
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
