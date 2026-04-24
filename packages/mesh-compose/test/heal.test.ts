import { describe, it, expect } from "vitest";
import { heal, approve } from "../src/index.js";
import type { ComposeAuthor } from "../src/index.js";
import type { AgentConfig } from "@corelay/mesh-core";
import type { RegressionReport, CaseComparison } from "@corelay/mesh-eval";

const currentConfig: AgentConfig = {
  name: "triage",
  description: "Triage agent.",
  prompt: "You are a triage agent. Be helpful.",
  model: "gpt-4o-mini",
  maxResponseTokens: 400,
  welcomeMessage: "Hi.",
  guardrails: "Never minimise.\nNever blame.",
  tools: [],
  capabilities: [],
};

const regressions: CaseComparison[] = [
  { caseId: "tone-warm", baseline: "pass", candidate: "fail", status: "regression" },
  { caseId: "no-blame", baseline: "pass", candidate: "fail", status: "regression" },
];

const makeReport = (regs: CaseComparison[]): RegressionReport => ({
  suite: "triage",
  baselineScore: 1.0,
  candidateScore: 0.5,
  scoreDelta: -0.5,
  regressions: regs,
  improvements: [],
  stable: [],
  newCases: [],
  removedCases: [],
  canDeploy: false,
});

const fixAuthor: ComposeAuthor = {
  draft: async () => JSON.stringify({
    name: "triage",
    description: "Fixed triage agent.",
    prompt: "You are a trauma-informed triage agent. Never minimise. Always warm.",
    welcomeMessage: "You're safe here.",
    reviewerQuestions: ["Does the fix address both regressions?"],
  }),
};

describe("heal()", () => {
  it("produces a ComposeDraft targeting the regressed cases", async () => {
    const result = await heal(currentConfig, makeReport(regressions), fixAuthor);
    expect(result.targetedCases).toHaveLength(2);
    expect(result.targetedCases[0]?.caseId).toBe("tone-warm");
    expect(result.draft.config.prompt).toContain("trauma-informed");
  });

  it("preserves guardrails from the current config", async () => {
    const result = await heal(currentConfig, makeReport(regressions), fixAuthor);
    expect(result.draft.config.guardrails).toContain("Never minimise");
  });

  it("the draft goes through the same approve() gate", async () => {
    const result = await heal(currentConfig, makeReport(regressions), fixAuthor);
    const approved = approve(result.draft, { model: "gpt-4o" });
    expect(approved.model).toBe("gpt-4o");
    expect(approved.prompt).toContain("trauma-informed");
  });

  it("throws when there are no regressions", async () => {
    await expect(
      heal(currentConfig, makeReport([]), fixAuthor),
    ).rejects.toThrow("No regressions");
  });

  it("includes the regression report in the result", async () => {
    const report = makeReport(regressions);
    const result = await heal(currentConfig, report, fixAuthor);
    expect(result.regression).toBe(report);
    expect(result.regression.canDeploy).toBe(false);
  });
});
