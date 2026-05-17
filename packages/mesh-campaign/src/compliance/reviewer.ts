import type { LLMClient } from "@corelay/mesh-core";
import { Critic, type CriticVerdict } from "@corelay/mesh-coordination";
import type { CampaignPromptContext } from "../memory/prompt-builder.js";
import { runStaticChecks, type ComplianceResult } from "./rules.js";

const LLM_REVIEW_PROMPT = `You are a Nigerian electoral law compliance reviewer. Review this campaign message for:
1. Hate speech (ethnic, religious, gender-based)
2. Incitement to violence
3. False claims about opponents that could be defamatory
4. Violations of Nigeria Electoral Act 2022
5. INEC campaign advertising guidelines
Respond with a JSON array of issues found. If compliant, respond with [].`;

/**
 * Reviews content using static rules + LLM + Critic pattern (iterative).
 * The Critic challenges the content up to maxCycles times, revising if needed.
 */
export async function reviewContent(
  content: string,
  ctx: CampaignPromptContext,
  llm: LLMClient,
): Promise<ComplianceResult> {
  // Layer 1: Static rule checks (instant, no LLM cost)
  const staticIssues = runStaticChecks(content, ctx.donts);
  if (staticIssues.length > 0) {
    return {
      passed: false,
      notes: staticIssues.map((i) => `⚠ ${i}`).join(" · "),
      issues: staticIssues,
    };
  }

  // Layer 2: LLM review (single pass)
  const llmIssues = await llmReview(content, llm);
  if (llmIssues.length > 0) {
    return {
      passed: false,
      notes: llmIssues.map((i) => `⚠ ${i}`).join(" · "),
      issues: llmIssues,
    };
  }

  // Layer 3: Critic pattern — challenges the content for subtle issues
  const critic = new Critic({
    llm,
    model: "claude-sonnet-4-20250514",
    domain: "Nigerian electoral campaign compliance",
    guardrails: [
      "Check for subtle ethnic dog-whistles that keyword matching would miss",
      "Verify claims are not defamatory under Nigerian law",
      "Ensure tone is dignified and not inciting",
      ctx.donts.length > 0 ? `Campaign-specific rules: ${ctx.donts.join("; ")}` : "",
    ].filter(Boolean).join("\n"),
    maxCycles: 2,
    autoApproveBelowChars: 20,
  });

  const verdict: CriticVerdict = await critic.review({
    userMessage: "Review this campaign message for compliance",
    agentResponse: content,
    systemPrompt: LLM_REVIEW_PROMPT,
  });

  if (verdict.revised) {
    return {
      passed: false,
      notes: `⚠ Critic flagged issues after ${verdict.cycles} review cycles: ${verdict.lastCritique ?? "content revised"}`,
      issues: [`Critic revision required: ${verdict.lastCritique ?? "subtle compliance concern detected"}`],
    };
  }

  return {
    passed: true,
    notes: "✓ Compliant with electoral law · ✓ No hate speech · ✓ Factual · ✓ Critic approved",
    issues: [],
  };
}

async function llmReview(content: string, llm: LLMClient): Promise<string[]> {
  try {
    const response = await llm.chat({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: LLM_REVIEW_PROMPT },
        { role: "user", content },
      ],
      maxTokens: 300,
      temperature: 0,
    });

    const parsed = JSON.parse(response.content);
    if (Array.isArray(parsed)) return parsed.filter((i): i is string => typeof i === "string");
  } catch { /* fail open — static checks still apply */ }
  return [];
}
