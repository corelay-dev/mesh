import { describe, it, expect } from "vitest";
import { extractRule } from "../src/reflection/extract-rules.js";
import type { LLMClient } from "@corelay/mesh-core";
import type { EditCapture } from "../src/reflection/capture-edits.js";

const mockLLM: LLMClient = {
  name: "mock",
  async chat() {
    return {
      content: "Use shorter sentences for WhatsApp messages",
      model: "mock",
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      finishReason: "stop",
    };
  },
};

describe("extractRule", () => {
  it("returns a learned rule from LLM response", async () => {
    const edit: EditCapture = {
      messageId: "msg-1",
      campaignId: "camp-1",
      originalContent: "This is a very long message that goes on and on about infrastructure development in the local government area",
      editedContent: "Infrastructure update: new roads coming to your LGA",
      editedBy: "user-1",
      editedAt: new Date(),
    };

    const rule = await extractRule(edit, mockLLM);
    expect(rule.rule).toBe("Use shorter sentences for WhatsApp messages");
    expect(rule.campaignId).toBe("camp-1");
    expect(rule.confidence).toBe(0.7);
    expect(rule.source).toBe("msg-1");
    expect(rule.id).toBeDefined();
  });
});
