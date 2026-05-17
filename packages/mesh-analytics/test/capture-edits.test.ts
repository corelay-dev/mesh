import { describe, it, expect } from "vitest";
import { captureEdit, diffContent } from "../src/reflection/capture-edits.js";

describe("captureEdit", () => {
  it("creates an EditCapture with metadata", () => {
    const result = captureEdit("Hello world", "Hello Nigeria", {
      messageId: "msg-1",
      campaignId: "camp-1",
      editedBy: "user-1",
    });
    expect(result.originalContent).toBe("Hello world");
    expect(result.editedContent).toBe("Hello Nigeria");
    expect(result.messageId).toBe("msg-1");
    expect(result.editedBy).toBe("user-1");
    expect(result.editedAt).toBeInstanceOf(Date);
  });
});

describe("diffContent", () => {
  it("detects replacements when chunks change", () => {
    const diff = diffContent("Hello world", "Hello beautiful world");
    expect(diff).toContain("Replaced");
  });

  it("detects removals when content is shortened", () => {
    const diff = diffContent(
      "Our candidate built roads. He also built schools. And hospitals.",
      "Our candidate built roads.",
    );
    expect(diff).toContain("Removed");
    expect(diff).toContain("Significantly shortened");
  });

  it("detects additions when content is expanded", () => {
    const diff = diffContent(
      "Vote for progress.",
      "Vote for progress. Our roads are being built. Schools are funded. The future is bright.",
    );
    expect(diff).toContain("Added");
    expect(diff).toContain("Significantly expanded");
  });

  it("returns no changes for identical content", () => {
    const diff = diffContent("Hello world", "Hello world");
    expect(diff).toBe("No changes detected");
  });

  it("handles multi-sentence replacements", () => {
    const diff = diffContent(
      "We will crush the opposition. They are useless.",
      "We will outperform the competition. They lack vision.",
    );
    expect(diff).toContain("Replaced");
  });
});
