import { describe, it, expect } from "vitest";
import { validateContent, formatForPlatform, PLATFORM_CONSTRAINTS } from "../src/platforms/formatter.js";

describe("validateContent", () => {
  it("returns valid for content within limits", () => {
    const result = validateContent("Hello world", "twitter");
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("flags content exceeding character limit", () => {
    const long = "a".repeat(281);
    const result = validateContent(long, "twitter");
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("280");
  });

  it("flags too many hashtags", () => {
    const content = "#one #two #three #four";
    const result = validateContent(content, "twitter");
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("hashtags");
  });

  it("allows up to 30 hashtags on instagram", () => {
    const tags = Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(" ");
    const result = validateContent(tags, "instagram");
    expect(result.valid).toBe(true);
  });

  it("disallows hashtags on sms", () => {
    const result = validateContent("#hello", "sms");
    expect(result.valid).toBe(false);
  });

  it("returns invalid for unknown platform", () => {
    const result = validateContent("test", "tiktok");
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("Unknown platform");
  });

  it("validates whatsapp_status 700 char limit", () => {
    const content = "a".repeat(701);
    const result = validateContent(content, "whatsapp_status");
    expect(result.valid).toBe(false);
  });

  it("validates facebook 63206 char limit", () => {
    const content = "a".repeat(100);
    const result = validateContent(content, "facebook");
    expect(result.valid).toBe(true);
  });
});

describe("formatForPlatform", () => {
  it("truncates content exceeding char limit", () => {
    const long = "a".repeat(300);
    const result = formatForPlatform(long, "twitter");
    expect(result.length).toBeLessThanOrEqual(280);
    expect(result.endsWith("…")).toBe(true);
  });

  it("removes hashtags for sms", () => {
    const result = formatForPlatform("Hello #world #test", "sms");
    expect(result).not.toContain("#");
  });

  it("limits hashtags to platform max", () => {
    const content = "Post #one #two #three #four #five";
    const result = formatForPlatform(content, "twitter");
    const hashtags = result.match(/#\w+/g) ?? [];
    expect(hashtags.length).toBeLessThanOrEqual(3);
  });

  it("returns content unchanged if within limits", () => {
    const content = "Short post #tag";
    const result = formatForPlatform(content, "twitter");
    expect(result).toBe(content);
  });

  it("returns content unchanged for unknown platform", () => {
    const content = "test content";
    const result = formatForPlatform(content, "unknown");
    expect(result).toBe(content);
  });
});

describe("PLATFORM_CONSTRAINTS", () => {
  it("has all expected platforms", () => {
    expect(PLATFORM_CONSTRAINTS).toHaveProperty("twitter");
    expect(PLATFORM_CONSTRAINTS).toHaveProperty("instagram");
    expect(PLATFORM_CONSTRAINTS).toHaveProperty("facebook");
    expect(PLATFORM_CONSTRAINTS).toHaveProperty("whatsapp_status");
    expect(PLATFORM_CONSTRAINTS).toHaveProperty("whatsapp");
    expect(PLATFORM_CONSTRAINTS).toHaveProperty("sms");
  });

  it("has correct twitter constraints", () => {
    expect(PLATFORM_CONSTRAINTS.twitter).toEqual({
      maxChars: 280,
      maxHashtags: 3,
      aspectRatio: "16:9",
    });
  });
});
