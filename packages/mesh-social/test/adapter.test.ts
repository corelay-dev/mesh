import { describe, it, expect, vi } from "vitest";
import type { PlatformAdapter, PostResult, EngagementMetrics, Reply, SocialEvent } from "../src/platforms/types.js";

/** Mock adapter for testing the PlatformAdapter interface contract */
function createMockAdapter(overrides?: Partial<PlatformAdapter>): PlatformAdapter {
  return {
    post: vi.fn(async (content: string, _media?: Buffer[]): Promise<PostResult> => ({
      postId: "mock-post-123",
      url: `https://mock.social/post/mock-post-123`,
      publishedAt: new Date("2025-01-15T10:00:00Z"),
    })),
    getEngagement: vi.fn(async (_postId: string): Promise<EngagementMetrics> => ({
      likes: 42, shares: 10, comments: 5, impressions: 1200, reach: 900,
    })),
    getReplies: vi.fn(async (_postId: string): Promise<Reply[]> => ([
      { id: "reply-1", author: "user123", content: "Great post!", createdAt: new Date() },
      { id: "reply-2", author: "user456", content: "I disagree", createdAt: new Date() },
    ])),
    async *monitor(_keywords: string[]): AsyncIterable<SocialEvent> {
      yield { id: "event-1", platform: "mock", type: "post", author: "user789", content: "Trending topic", createdAt: new Date() };
      yield { id: "event-2", platform: "mock", type: "mention", author: "user101", content: "Mentioned you", createdAt: new Date() };
    },
    ...overrides,
  };
}

describe("PlatformAdapter interface contract", () => {
  it("post() returns PostResult with required fields", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.post("Hello world");

    expect(result.postId).toBe("mock-post-123");
    expect(result.url).toContain("mock-post-123");
    expect(result.publishedAt).toBeInstanceOf(Date);
  });

  it("post() accepts optional media buffers", async () => {
    const adapter = createMockAdapter();
    const media = [Buffer.from("fake-image-data")];
    const result = await adapter.post("Post with image", media);

    expect(result.postId).toBeTruthy();
    expect(adapter.post).toHaveBeenCalledWith("Post with image", media);
  });

  it("getEngagement() returns metrics", async () => {
    const adapter = createMockAdapter();
    const metrics = await adapter.getEngagement("post-123");

    expect(metrics.likes).toBe(42);
    expect(metrics.shares).toBe(10);
    expect(metrics.comments).toBe(5);
    expect(metrics.impressions).toBe(1200);
    expect(metrics.reach).toBe(900);
  });

  it("getReplies() returns array of Reply objects", async () => {
    const adapter = createMockAdapter();
    const replies = await adapter.getReplies("post-123");

    expect(replies).toHaveLength(2);
    expect(replies[0].id).toBe("reply-1");
    expect(replies[0].author).toBe("user123");
    expect(replies[0].content).toBe("Great post!");
    expect(replies[0].createdAt).toBeInstanceOf(Date);
  });

  it("monitor() yields SocialEvent objects", async () => {
    const adapter = createMockAdapter();
    const events: SocialEvent[] = [];

    for await (const event of adapter.monitor(["keyword"])) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("event-1");
    expect(events[0].platform).toBe("mock");
    expect(events[0].type).toBe("post");
    expect(events[1].type).toBe("mention");
  });

  it("handles post failure gracefully", async () => {
    const adapter = createMockAdapter({
      post: async () => {
        throw new Error("Network error");
      },
    });

    await expect(adapter.post("will fail")).rejects.toThrow("Network error");
  });

  it("getEngagement() handles missing post gracefully", async () => {
    const adapter = createMockAdapter({
      getEngagement: async () => ({ likes: 0, shares: 0, comments: 0, impressions: 0, reach: 0 }),
    });

    const metrics = await adapter.getEngagement("nonexistent");
    expect(metrics.likes).toBe(0);
  });

  it("close() is optional and callable", async () => {
    const closeFn = vi.fn(async () => {});
    const adapter = createMockAdapter();
    (adapter as any).close = closeFn;

    if (adapter.close) await adapter.close();
    expect(closeFn).toHaveBeenCalled();
  });
});
