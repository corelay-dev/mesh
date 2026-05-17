import type { Address, PeerRegistry } from "@corelay/mesh-core";
import { run } from "@corelay/mesh-core";
import type { ComplianceResult } from "../compliance/rules.js";
import type { VerificationResult } from "../agents/research.js";

export interface RapidResponseInput {
  campaignId: string;
  opponentClaim: string;
  channel: "twitter" | "facebook" | "whatsapp";
  language: "en" | "yo" | "ha" | "ig" | "pcm";
}

export interface RapidResponseResult {
  counterNarrative: string;
  compliance: ComplianceResult | null;
  verification: VerificationResult | null;
  approved: boolean;
  reason: string;
  errors: string[];
}

/**
 * Rapid response workflow:
 * 1. Research verifies the opponent's claim
 * 2. Narrative drafts a counter-response
 * 3. Compliance reviews
 * 4. If all pass → ready for approval queue
 *
 * Handles partial failures — if research times out, still generates counter-narrative
 * but marks as needing human verification.
 */
export async function runRapidResponse(
  registry: PeerRegistry,
  input: RapidResponseInput,
): Promise<RapidResponseResult> {
  const { campaignId, opponentClaim, channel, language } = input;
  const errors: string[] = [];

  // Step 1: Research verifies the opponent's claim (non-blocking failure)
  let verification: VerificationResult | null = null;
  try {
    const verifyResult = await run(
      registry,
      "campaign/research" as Address,
      JSON.stringify({ kind: "verify_claims", campaignId, claims: [opponentClaim] }),
      { timeoutMs: 45_000 },
    );
    verification = JSON.parse(verifyResult.content);
  } catch (err) {
    errors.push(`Research verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2: Narrative drafts counter-response
  let counterNarrative: string;
  try {
    const narrativeResult = await run(
      registry,
      "campaign/narrative" as Address,
      JSON.stringify({ kind: "counter", campaignId, opponentClaim, channel, language }),
      { timeoutMs: 30_000 },
    );
    const narrativeOutputs = JSON.parse(narrativeResult.content);
    counterNarrative = narrativeOutputs[0]?.content ?? "";
  } catch (err) {
    return {
      counterNarrative: "",
      compliance: null,
      verification,
      approved: false,
      reason: `Narrative generation failed: ${err instanceof Error ? err.message : String(err)}`,
      errors: [...errors, `Narrative failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  // Step 3: Compliance reviews the counter-narrative
  let compliance: ComplianceResult | null = null;
  try {
    const complianceResult = await run(
      registry,
      "campaign/compliance" as Address,
      JSON.stringify({ content: counterNarrative, campaignId }),
      { timeoutMs: 30_000 },
    );
    compliance = JSON.parse(complianceResult.content);
  } catch (err) {
    errors.push(`Compliance review failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Determine if auto-approvable
  const compliancePassed = compliance?.passed ?? false;
  const verificationReliable = verification ? verification.overallReliability !== "low" : false;

  let approved: boolean;
  let reason: string;

  if (!compliance) {
    approved = false;
    reason = "Compliance review unavailable — needs manual review";
  } else if (!compliancePassed) {
    approved = false;
    reason = `Compliance failed: ${compliance.notes}`;
  } else if (!verification) {
    approved = false;
    reason = "Research verification unavailable — needs human fact-check before publishing";
  } else if (!verificationReliable) {
    approved = false;
    reason = "Research could not verify underlying facts — needs human review";
  } else {
    approved = true;
    reason = "Passed all checks — ready for one-tap approval";
  }

  return { counterNarrative, compliance, verification, approved, reason, errors };
}
