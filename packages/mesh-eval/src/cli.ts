#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { runEval } from "./run.js";
import { createMockJudge } from "./mock-judge.js";
import type { EvalJudge, EvalReport, EvalSuite, EvalTarget } from "./types.js";

export interface CliOptions {
  suitePath: string;
  outputDir?: string;
  judge?: EvalJudge;
  target?: EvalTarget;
}

/**
 * Load a suite JSON from disk, run it, write results, return exit code.
 * Separated from the process.exit call so it's testable.
 */
export const runCli = async (options: CliOptions): Promise<{ report: EvalReport; exitCode: number }> => {
  const raw = await readFile(options.suitePath, "utf-8");
  const suite: EvalSuite = JSON.parse(raw) as EvalSuite;

  const judge = options.judge ?? createMockJudge();
  const target = options.target ?? createFixtureTarget(suite);

  const report = await runEval(suite, target, { judge });

  const outputDir = options.outputDir ?? resolve(dirname(options.suitePath), "..", "eval-results");
  await mkdir(outputDir, { recursive: true });

  const outputPath = resolve(outputDir, `${suite.name}.json`);
  await writeFile(outputPath, JSON.stringify(toOutputReport(report), null, 2), "utf-8");

  const exitCode = report.gatePassed ? 0 : 1;
  return { report, exitCode };
};

/** Minimal regression-friendly JSON output (no reply bodies, just scores). */
export interface OutputReport {
  suite: string;
  score: number;
  passThreshold: number;
  gatePassed: boolean;
  total: number;
  passed: number;
  failed: number;
  cases: ReadonlyArray<{
    caseId: string;
    pass: boolean;
    weight: number;
    durationMs: number;
  }>;
  startedAt: string;
  finishedAt: string;
}

export const toOutputReport = (report: EvalReport): OutputReport => ({
  suite: report.suite,
  score: report.score,
  passThreshold: report.passThreshold,
  gatePassed: report.gatePassed,
  total: report.total,
  passed: report.passed,
  failed: report.failed,
  cases: report.cases.map((c) => ({
    caseId: c.caseId,
    pass: c.pass,
    weight: c.weight,
    durationMs: c.durationMs,
  })),
  startedAt: report.startedAt,
  finishedAt: report.finishedAt,
});

/**
 * Default fixture target that echoes a canned response derived from the
 * suite's assertions. Good enough for CI smoke runs with no real agent.
 */
const createFixtureTarget = (suite: EvalSuite): EvalTarget => {
  const responses = new Map<string, string>();
  for (const c of suite.cases) {
    const parts: string[] = [];
    for (const a of c.assertions) {
      if (a.kind === "contains") parts.push(a.value);
    }
    responses.set(c.input, parts.join(". ") || "I'm here to help you.");
  }
  return async (input) => responses.get(input) ?? "I'm here to help you with that.";
};

/** CLI main — parse argv, run, exit. */
const main = async (): Promise<void> => {
  const args = process.argv.slice(2);

  if (args[0] !== "run" || !args[1]) {
    process.stderr.write("Usage: mesh-eval run <suite.json> [--output-dir <dir>]\n");
    process.exit(2);
  }

  const suitePath = resolve(args[1]);
  const outputDirIdx = args.indexOf("--output-dir");
  const outputDir = outputDirIdx !== -1 ? args[outputDirIdx + 1] : undefined;

  const { report, exitCode } = await runCli({ suitePath, outputDir });

  const icon = report.gatePassed ? "✓" : "✗";
  process.stdout.write(
    `${icon} ${report.suite}: score=${report.score.toFixed(3)} threshold=${report.passThreshold} (${report.passed}/${report.total} passed)\n`,
  );

  process.exit(exitCode);
};

// Only run main when invoked directly (not imported for testing)
const isDirectRun = process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts");
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
}
