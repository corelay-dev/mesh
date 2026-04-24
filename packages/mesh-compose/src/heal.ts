import type { AgentConfig } from "@corelay/mesh-core";
import type { RegressionReport, CaseComparison } from "@corelay/mesh-eval";
import type { ComposeAuthor, ComposeDraft } from "./types.js";
import { compose } from "./compose.js";

export interface HealingResult {
  /** The regression that triggered healing. */
  regression: RegressionReport;
  /** The fix Compose drafted. */
  draft: ComposeDraft;
  /** Which regressed cases the fix targets. */
  targetedCases: ReadonlyArray<CaseComparison>;
}

/**
 * Self-healing: given a regression report and the current agent config,
 * Compose drafts a fix that addresses the regressed cases.
 *
 * The fix is a ComposeDraft — it goes through the same review gate as
 * any other Compose output. Nothing auto-deploys. The human reviews
 * the fix, approves or rejects, and the deploy pipeline takes over.
 *
 * This closes the loop: eval regression → Compose fix → human review →
 * deploy. One review step from regression to resolution.
 */
export const heal = async (
  currentConfig: AgentConfig,
  regression: RegressionReport,
  author: ComposeAuthor,
): Promise<HealingResult> => {
  const regressed = regression.regressions;
  if (regressed.length === 0) {
    throw new Error("No regressions to heal");
  }

  const healingIntent = buildHealingIntent(currentConfig, regressed);

  const draft = await compose(
    {
      intent: healingIntent,
      guardrails: currentConfig.guardrails
        ? currentConfig.guardrails.split("\n").filter(Boolean)
        : undefined,
    },
    author,
  );

  return {
    regression,
    draft,
    targetedCases: regressed,
  };
};

const buildHealingIntent = (
  config: AgentConfig,
  regressed: ReadonlyArray<CaseComparison>,
): string => {
  const caseList = regressed
    .map((c) => `  - ${c.caseId}: was ${c.baseline}, now ${c.candidate}`)
    .join("\n");

  return [
    `Fix the "${config.name}" agent. The current prompt is:`,
    "",
    config.prompt,
    "",
    "The following eval cases regressed after the last change:",
    caseList,
    "",
    "Draft a revised prompt that fixes these regressions without breaking",
    "the cases that still pass. Keep the same tone and domain. Minimal changes.",
  ].join("\n");
};
