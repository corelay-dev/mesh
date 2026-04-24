/**
 * What the agent under test is given, and what we check against the reply.
 *
 * An EvalCase is deliberately simple: one input, a handful of assertions,
 * optional weight. Complex flows are authored as multiple cases rather
 * than one giant case, so a failing assertion surfaces precisely.
 */
export interface EvalCase {
  /** Stable id for reporting. e.g. "triage-greeting-01". */
  id: string;
  /** Short human-readable description of what this case verifies. */
  description: string;
  /** Input message sent to the agent. */
  input: string;
  /** Assertions the reply must satisfy. All must pass for the case to pass. */
  assertions: ReadonlyArray<Assertion>;
  /** Relative weight in aggregate scoring. Default 1. */
  weight?: number;
  /** Tags for filtering (e.g. "safeguarding", "smoke"). */
  tags?: ReadonlyArray<string>;
}

/**
 * A collection of eval cases, named, plus the threshold that decides
 * whether a deploy is gated.
 */
export interface EvalSuite {
  /** Stable slug. e.g. "safevoice-triage". */
  name: string;
  /** Short description. */
  description: string;
  /** The cases. */
  cases: ReadonlyArray<EvalCase>;
  /**
   * The minimum passing weight fraction required for the suite to PASS.
   * Default 1.0 — every weighted case must pass. Lower it deliberately.
   */
  passThreshold?: number;
}

/**
 * An assertion about a reply. Four kinds cover the common shapes;
 * anything else is an LLM-judged assertion.
 */
export type Assertion =
  | ContainsAssertion
  | NotContainsAssertion
  | MatchesAssertion
  | JudgedAssertion;

export interface ContainsAssertion {
  kind: "contains";
  /** Substring the reply MUST include (case-insensitive unless caseSensitive). */
  value: string;
  caseSensitive?: boolean;
  /** Short description for the report. */
  label?: string;
}

export interface NotContainsAssertion {
  kind: "notContains";
  value: string;
  caseSensitive?: boolean;
  label?: string;
}

export interface MatchesAssertion {
  kind: "matches";
  /** Regex pattern the reply must match. String form so suites are serialisable. */
  pattern: string;
  flags?: string;
  label?: string;
}

/**
 * LLM-judged rubric. A judge LLM sees the reply + this rubric and returns
 * a boolean pass/fail + rationale. Use sparingly; programmatic assertions
 * are cheaper and more deterministic.
 */
export interface JudgedAssertion {
  kind: "judged";
  /** Plain-English criterion. e.g. "reply is trauma-informed and non-judgemental". */
  criterion: string;
  label?: string;
}

/**
 * The target of the evaluation. A function that turns an input into a reply.
 * This abstraction means we can evaluate Compose drafts, running Agents,
 * shadow-traffic replays, or anything else uniformly.
 */
export type EvalTarget = (input: string) => Promise<string>;

/**
 * An LLM judge for JudgedAssertion evaluation. Returns pass/fail + rationale.
 */
export interface EvalJudge {
  judge(input: {
    criterion: string;
    reply: string;
    originalInput: string;
  }): Promise<{ pass: boolean; rationale: string }>;
}

/** Per-assertion result. */
export interface AssertionResult {
  kind: Assertion["kind"];
  label: string;
  pass: boolean;
  /** Why it failed (or what the judge said on a judged assertion). */
  message?: string;
}

/** Per-case result. */
export interface CaseResult {
  caseId: string;
  description: string;
  input: string;
  reply: string;
  pass: boolean;
  weight: number;
  assertions: ReadonlyArray<AssertionResult>;
  /** Total ms spent on the target call for this case. */
  durationMs: number;
}

/** Full suite report. */
export interface EvalReport {
  suite: string;
  total: number;
  passed: number;
  failed: number;
  /** weightedPass / weightedTotal. Between 0 and 1. */
  score: number;
  passThreshold: number;
  gatePassed: boolean;
  cases: ReadonlyArray<CaseResult>;
  startedAt: string;
  finishedAt: string;
}
