import type { EvalJudge } from "./types.js";

/**
 * A deterministic mock judge for CI environments where no LLM API key is
 * available. Returns pass=true when the reply is non-empty and >10 chars,
 * which is enough for fixture suites to exercise the full pipeline.
 *
 * Override via the `verdicts` map for deterministic per-criterion control.
 */
export interface MockJudgeOptions {
  /** Override verdicts keyed by criterion substring. First match wins. */
  verdicts?: ReadonlyMap<string, boolean>;
  /** Default verdict when no override matches. Default: true. */
  defaultPass?: boolean;
}

export const createMockJudge = (options: MockJudgeOptions = {}): EvalJudge => {
  const defaultPass = options.defaultPass ?? true;
  const verdicts = options.verdicts ?? new Map<string, boolean>();

  return {
    judge: async ({ criterion, reply }) => {
      for (const [key, pass] of verdicts) {
        if (criterion.includes(key)) {
          return {
            pass,
            rationale: `Mock judge: matched override for "${key}"`,
          };
        }
      }

      const pass = reply.length > 10 ? defaultPass : false;
      const rationale = pass
        ? "Mock judge: reply is non-trivial, auto-pass"
        : "Mock judge: reply too short or default-fail";

      return { pass, rationale };
    },
  };
};
