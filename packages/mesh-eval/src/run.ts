import { evaluateAssertion } from "./assertions.js";
import type {
  CaseResult,
  EvalCase,
  EvalJudge,
  EvalReport,
  EvalSuite,
  EvalTarget,
} from "./types.js";

export interface RunEvalOptions {
  /** Optional LLM judge for JudgedAssertion cases. */
  judge?: EvalJudge;
  /** Optional hook called after each case. Useful for progress UI. */
  onCaseComplete?: (result: CaseResult) => void;
}

/**
 * Run every case in a suite against a target. Produces a full report
 * including per-case, per-assertion outcomes, aggregate score, and the
 * gate decision.
 *
 * Runs cases sequentially — not because concurrency is impossible but
 * because order helps when logs scroll past. Add concurrency later if
 * suites grow; they rarely need to.
 */
export const runEval = async (
  suite: EvalSuite,
  target: EvalTarget,
  options: RunEvalOptions = {},
): Promise<EvalReport> => {
  const startedAt = new Date().toISOString();
  const passThreshold = suite.passThreshold ?? 1.0;

  const results: CaseResult[] = [];
  for (const c of suite.cases) {
    const result = await runCase(c, target, options.judge);
    results.push(result);
    options.onCaseComplete?.(result);
  }

  const finishedAt = new Date().toISOString();

  const weightedTotal = results.reduce((sum, r) => sum + r.weight, 0);
  const weightedPass = results.reduce(
    (sum, r) => sum + (r.pass ? r.weight : 0),
    0,
  );
  const score = weightedTotal === 0 ? 1 : weightedPass / weightedTotal;
  const passed = results.filter((r) => r.pass).length;

  return {
    suite: suite.name,
    total: results.length,
    passed,
    failed: results.length - passed,
    score,
    passThreshold,
    gatePassed: score >= passThreshold,
    cases: results,
    startedAt,
    finishedAt,
  };
};

const runCase = async (
  c: EvalCase,
  target: EvalTarget,
  judge?: EvalJudge,
): Promise<CaseResult> => {
  const weight = c.weight ?? 1;
  const start = Date.now();
  let reply: string;
  try {
    reply = await target(c.input);
  } catch (err) {
    const duration = Date.now() - start;
    return {
      caseId: c.id,
      description: c.description,
      input: c.input,
      reply: "",
      pass: false,
      weight,
      durationMs: duration,
      assertions: [
        {
          kind: c.assertions[0]?.kind ?? "contains",
          label: "target threw",
          pass: false,
          message: `Target threw: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  const assertionResults = [];
  for (const a of c.assertions) {
    const result = await evaluateAssertion(a, reply, c.input, judge);
    assertionResults.push(result);
  }

  const durationMs = Date.now() - start;
  const pass = assertionResults.every((a) => a.pass);

  return {
    caseId: c.id,
    description: c.description,
    input: c.input,
    reply,
    pass,
    weight,
    assertions: assertionResults,
    durationMs,
  };
};
