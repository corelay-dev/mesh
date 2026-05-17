import { describe, it, expect, vi } from "vitest";
import { extractContent } from "../src/repurposer/extract-content.js";

describe("extractContent", () => {
  it("returns plain string as-is", async () => {
    const result = await extractContent("Hello world");
    expect(result.text).toBe("Hello world");
    expect(result.sourceUrl).toBeUndefined();
  });

  it("strips HTML tags from fetched content", async () => {
    const html = "<html><head><title>Test Page</title></head><body><p>Hello <b>world</b></p></body></html>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    }));

    const result = await extractContent("https://example.com/article");
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("world");
    expect(result.text).not.toContain("<p>");
    expect(result.text).not.toContain("<b>");
    expect(result.title).toBe("Test Page");
    expect(result.sourceUrl).toBe("https://example.com/article");

    vi.unstubAllGlobals();
  });

  it("strips script and style tags", async () => {
    const html = "<html><body><script>alert('x')</script><style>.a{}</style><p>Content</p></body></html>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    }));

    const result = await extractContent("https://example.com");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toContain(".a{}");
    expect(result.text).toContain("Content");

    vi.unstubAllGlobals();
  });

  it("handles URL objects", async () => {
    const html = "<html><body>Test</body></html>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    }));

    const result = await extractContent(new URL("https://example.com"));
    expect(result.sourceUrl).toBe("https://example.com/");

    vi.unstubAllGlobals();
  });

  it("throws on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(extractContent("https://example.com/404")).rejects.toThrow("Fetch failed: 404");
    vi.unstubAllGlobals();
  });
});
