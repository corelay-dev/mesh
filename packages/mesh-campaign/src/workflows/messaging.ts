import type { Address, PeerRegistry } from "@corelay/mesh-core";
import { run } from "@corelay/mesh-core";
import type { Channel, Language } from "../schemas/message.js";
import type { ComplianceResult } from "../compliance/rules.js";
import type { NarrativeOutput } from "../agents/narrative.js";

export interface MessagingWorkflowMessage {
  content: string;
  tone: string;
  targetAudience: string;
  compliance: ComplianceResult;
  impactScore: number;
}

export interface MessagingWorkflowResult {
  messages: MessagingWorkflowMessage[];
  errors: string[];
}

export interface MessagingWorkflowOpts {
  registry: PeerRegistry;
  campaignId: string;
  task: string;
  channel: Channel;
  language: Language;
  count?: number;
  timeoutMs?: number;
}

/**
 * Messaging workflow: Narrative generates → Compliance reviews each → score.
 * Handles partial failures gracefully — if compliance times out for one message,
 * the others still return.
 */
export async function runMessagingWorkflow(opts: MessagingWorkflowOpts): Promise<MessagingWorkflowResult> {
  const { registry, campaignId, task, channel, language, count = 3, timeoutMs = 60_000 } = opts;
  const errors: string[] = [];

  // Step 1: Narrative generates batch
  let narrativeOutputs: NarrativeOutput[];
  try {
    const narrativeResult = await run(
      registry,
      "campaign/narrative" as Address,
      JSON.stringify({ kind: "batch", campaignId, task, channel, language, count }),
      { timeoutMs },
    );
    narrativeOutputs = JSON.parse(narrativeResult.content);
  } catch (err) {
    return {
      messages: [],
      errors: [`Narrative generation failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  // Step 2: Compliance reviews each message (partial failure tolerant)
  const messages: MessagingWorkflowMessage[] = [];

  for (const msg of narrativeOutputs) {
    try {
      const complianceResult = await run(
        registry,
        "campaign/compliance" as Address,
        JSON.stringify({ content: msg.content, campaignId }),
        { timeoutMs: 30_000 },
      );
      const compliance: ComplianceResult = JSON.parse(complianceResult.content);
      const impactScore = scoreImpact(msg.content, channel);

      messages.push({
        content: msg.content,
        tone: msg.tone,
        targetAudience: msg.targetAudience,
        compliance,
        impactScore,
      });
    } catch (err) {
      errors.push(`Compliance review failed for message: ${err instanceof Error ? err.message : String(err)}`);
      // Still include the message but mark compliance as unknown
      messages.push({
        content: msg.content,
        tone: msg.tone,
        targetAudience: msg.targetAudience,
        compliance: { passed: false, notes: "⚠ Compliance review timed out — manual review required", issues: ["Review timeout"] },
        impactScore: scoreImpact(msg.content, channel),
      });
    }
  }

  return { messages, errors };
}

function scoreImpact(content: string, channel: Channel): number {
  let score = 50;

  const len = content.length;
  if (channel === "twitter" && len <= 280) score += 15;
  else if (channel === "twitter" && len > 280) score -= 20;
  if (channel === "whatsapp" && len >= 50 && len <= 500) score += 10;
  if (channel === "sms" && len <= 160) score += 15;
  else if (channel === "sms" && len > 160) score -= 30;

  if (content.includes("?")) score += 5;
  if (content.includes("#")) score += 3;
  if (/\b(you|your|we|our)\b/i.test(content)) score += 5;

  return Math.max(0, Math.min(100, score));
}
