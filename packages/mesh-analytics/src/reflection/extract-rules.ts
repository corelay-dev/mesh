import type { LLMClient } from "@corelay/mesh-core";
import type { EditCapture } from "./capture-edits.js";
import type { LearnedRule } from "./store.js";

const EXTRACT_RULE_SYSTEM = `You are a writing style analyst for a Nigerian political campaign. Your job is to identify generalizable rules from human edits to AI-generated content. Rules should be specific enough to apply consistently but general enough to cover future content.`;

const EXTRACT_RULE_USER = (edit: EditCapture) =>
  `A campaign manager edited this AI-generated message before approving it.

Original:
${edit.originalContent}

Edited version:
${edit.editedContent}

What single, generalizable style or content rule does this edit imply? Respond with ONLY the rule as a short sentence (e.g., "Use conversational tone on Twitter" or "Always mention the candidate's name in the first line").`;

export async function extractRule(edit: EditCapture, llm: LLMClient): Promise<LearnedRule> {
  const response = await llm.chat({
    model: "claude-sonnet-4-20250514",
    messages: [
      { role: "system", content: EXTRACT_RULE_SYSTEM },
      { role: "user", content: EXTRACT_RULE_USER(edit) },
    ],
    maxTokens: 256,
    temperature: 0.3,
  });

  return {
    id: crypto.randomUUID(),
    campaignId: edit.campaignId,
    rule: response.content.trim(),
    confidence: 0.7,
    source: edit.messageId,
    createdAt: new Date(),
    lastApplied: null,
    applicationCount: 0,
  };
}
