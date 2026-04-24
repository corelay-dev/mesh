import { describe, it, expect } from "vitest";
import { compareReports, type RegressionReport } from "../src/index.js";
import type { EvalReport, CaseResult } from "../src/index.js";

const makeCase = (id: string, pass: boolean): CaseResult => ({
  caseId: id,
  description: id,
  input: "x",
  reply: "y",
  pass,
  weight: 1,
  assertions: [],
  durationMs: 10,
});

const makeReport = (
  cases: CaseResult[],
  overrides: Partial<EvalReport> = {},
): EvalReport => {
  const passed = cases.filter((c) => c.pass).length;
  const total = cases.length;
  return {
    suite: "test",
    total,
    passed,
    failed: total - passed,
    score: total === 0 ? 1 : passed / total,
    passThreshold: 1,
    gatePassed: passed === total,
    cases,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...overrides,
  };
};

describe("compareReports()", () => {
  it("reports stable-pass when both pass", () => {
    const base = makeReport([makeCase("a", true)]);
    const cand = makeReport([makeCase("a", true)]);
    const r = compareReports(base, cand);
    expect(r.stable).toHaveLength(1);
    expect(r.stable[0]?.status).toBe("stable-pass");
    expect(r.regressions).toHaveLength(0);
    expect(r.canDeploy).toBe(true);
  });

  it("reports stable-fail when both fail", () => {
    const base = makeReport([makeCase("a", false)]);
    const cand = makeReport([makeCase("a", false)]);
    const r = compareReports(base, cand);
    expect(r.stable).toHaveLength(1);
    expect(r.stable[0]?.status).toBe("stable-fail");
    // Gate didn't pass because candidate has failures
    expect(r.canDeploy).toBe(false);
  });

  it("detects a regression (was pass, now fail)", () => {
    const base = makeReport([makeCase("a", true)]);
    const cand = makeReport([makeCase("a", false)]);
    const r = compareReports(base, cand);
    expect(r.regressions).toHaveLength(1);
    expect(r.regressions[0]?.status).toBe("regression");
    expect(r.canDeploy).toBe(false);
  });

  it("detects an improvement (was fail, now pass)", () => {
    const base = makeReport([makeCase("a", false)]);
    const cand = makeReport([makeCase("a", true)]);
    const r = compareReports(base, cand);
    expect(r.improvements).toHaveLength(1);
    expect(r.improvements[0]?.status).toBe("improvement");
    expect(r.canDeploy).toBe(true);
  });

  it("flags new cases (in candidate but not baseline)", () => {
    const base = makeReport([makeCase("a", true)]);
    const cand = makeReport([makeCase("a", true), makeCase("b", true)]);
    const r = compareReports(base, cand);
    expect(r.newCases).toHaveLength(1);
    expect(r.newCases[0]?.caseId).toBe("b");
    expect(r.canDeploy).toBe(true);
  });

  it("flags removed cases as blocking (in baseline but not candidate)", () => {
    const base = makeReport([makeCase("a", true), makeCase("b", true)]);
    const cand = makeReport([makeCase("a", true)]);
    const r = compareReports(base, cand);
    expect(r.removedCases).toHaveLength(1);
    expect(r.removedCases[0]?.caseId).toBe("b");
    expect(r.canDeploy).toBe(false);
  });

  it("computes score delta", () => {
    const base = makeReport([makeCase("a", true), makeCase("b", false)]);
    const cand = makeReport([makeCase("a", true), makeCase("b", true)]);
    const r = compareReports(base, cand);
    expect(r.baselineScore).toBeCloseTo(0.5);
    expect(r.candidateScore).toBeCloseTo(1.0);
    expect(r.scoreDelta).toBeCloseTo(0.5);
  });

  it("blocks deploy when candidate gate fails even with no regressions", () => {
    const base = makeReport([makeCase("a", true)]);
    const cand = makeReport([makeCase("a", true)], { gatePassed: false });
    const r = compareReports(base, cand);
    expect(r.regressions).toHaveLength(0);
    expect(r.canDeploy).toBe(false);
  });
});
