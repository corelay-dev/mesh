import type { EvalReport, CaseResult } from "./types.js";

export interface CaseComparison {
  caseId: string;
  baseline: "pass" | "fail" | "missing";
  candidate: "pass" | "fail" | "missing";
  status: "stable-pass" | "stable-fail" | "regression" | "improvement" | "new" | "removed";
}

export interface RegressionReport {
  suite: string;
  baselineScore: number;
  candidateScore: number;
  scoreDelta: number;
  regressions: ReadonlyArray<CaseComparison>;
  improvements: ReadonlyArray<CaseComparison>;
  stable: ReadonlyArray<CaseComparison>;
  newCases: ReadonlyArray<CaseComparison>;
  removedCases: ReadonlyArray<CaseComparison>;
  /** True if the candidate has zero regressions AND its gate passed. */
  canDeploy: boolean;
}

/**
 * Compare two eval reports (baseline vs candidate) and produce a regression
 * report. The deploy decision is: zero regressions AND the candidate's own
 * gate passed.
 *
 * Cases are matched by `caseId`. A case present in the candidate but not
 * the baseline is "new"; present in the baseline but not the candidate is
 * "removed" (and counts as a regression — you can't silently drop coverage).
 */
export const compareReports = (
  baseline: EvalReport,
  candidate: EvalReport,
): RegressionReport => {
  const baseMap = new Map<string, CaseResult>();
  for (const c of baseline.cases) baseMap.set(c.caseId, c);

  const candMap = new Map<string, CaseResult>();
  for (const c of candidate.cases) candMap.set(c.caseId, c);

  const allIds = new Set([...baseMap.keys(), ...candMap.keys()]);

  const regressions: CaseComparison[] = [];
  const improvements: CaseComparison[] = [];
  const stable: CaseComparison[] = [];
  const newCases: CaseComparison[] = [];
  const removedCases: CaseComparison[] = [];

  for (const id of allIds) {
    const b = baseMap.get(id);
    const c = candMap.get(id);

    if (b && c) {
      const comp: CaseComparison = {
        caseId: id,
        baseline: b.pass ? "pass" : "fail",
        candidate: c.pass ? "pass" : "fail",
        status:
          b.pass && c.pass
            ? "stable-pass"
            : !b.pass && !c.pass
            ? "stable-fail"
            : b.pass && !c.pass
            ? "regression"
            : "improvement",
      };
      if (comp.status === "regression") regressions.push(comp);
      else if (comp.status === "improvement") improvements.push(comp);
      else stable.push(comp);
    } else if (c && !b) {
      newCases.push({
        caseId: id,
        baseline: "missing",
        candidate: c.pass ? "pass" : "fail",
        status: "new",
      });
    } else if (b && !c) {
      const comp: CaseComparison = {
        caseId: id,
        baseline: b.pass ? "pass" : "fail",
        candidate: "missing",
        status: "removed",
      };
      removedCases.push(comp);
    }
  }

  const canDeploy =
    regressions.length === 0 &&
    removedCases.length === 0 &&
    candidate.gatePassed;

  return {
    suite: candidate.suite,
    baselineScore: baseline.score,
    candidateScore: candidate.score,
    scoreDelta: candidate.score - baseline.score,
    regressions,
    improvements,
    stable,
    newCases,
    removedCases,
    canDeploy,
  };
};
