import { describe, it, expect, vi, afterEach } from "vitest";
import { runCli, toOutputReport } from "../src/cli.js";
import { createMockJudge } from "../src/mock-judge.js";
import type { EvalReport, EvalSuite, EvalTarget } from "../src/types.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const fixtureDir = resolve(tmpdir(), "mesh-eval-cli-test-" + Date.now());
const outputDir = resolve(fixtureDir, "results");

const passingSuite: EvalSuite = {
  name: "cli-pass",
  description: "Suite that should pass",
  passThreshold: 0.5,
  cases: [
    {
      id: "basic",
      description: "Contains hello",
      input: "greet",
      assertions: [{ kind: "contains", value: "hello" }],
    },
  ],
};

const failingSuite: EvalSuite = {
  name: "cli-fail",
  description: "Suite that should fail",
  passThreshold: 1.0,
  cases: [
    {
      id: "impossible",
      description: "Expects impossible match",
      input: "greet",
      assertions: [{ kind: "contains", value: "XYZNOTFOUND" }],
    },
  ],
};

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("runCli()", () => {
  it("returns exitCode 0 when gate passes", async () => {
    await mkdir(fixtureDir, { recursive: true });
    const suitePath = resolve(fixtureDir, "pass.json");
    await writeFile(suitePath, JSON.stringify(passingSuite));

    const target: EvalTarget = async () => "hello world, I'm here to help";
    const { report, exitCode } = await runCli({
      suitePath,
      outputDir,
      target,
      judge: createMockJudge(),
    });

    expect(exitCode).toBe(0);
    expect(report.gatePassed).toBe(true);
    expect(report.score).toBe(1);
  });

  it("returns exitCode 1 when gate fails", async () => {
    await mkdir(fixtureDir, { recursive: true });
    const suitePath = resolve(fixtureDir, "fail.json");
    await writeFile(suitePath, JSON.stringify(failingSuite));

    const target: EvalTarget = async () => "nope, nothing here";
    const { report, exitCode } = await runCli({
      suitePath,
      outputDir,
      target,
      judge: createMockJudge(),
    });

    expect(exitCode).toBe(1);
    expect(report.gatePassed).toBe(false);
  });

  it("writes JSON output to the specified directory", async () => {
    await mkdir(fixtureDir, { recursive: true });
    const suitePath = resolve(fixtureDir, "pass.json");
    await writeFile(suitePath, JSON.stringify(passingSuite));

    const target: EvalTarget = async () => "hello there friend";
    await runCli({ suitePath, outputDir, target, judge: createMockJudge() });

    const { readFile } = await import("node:fs/promises");
    const written = await readFile(resolve(outputDir, "cli-pass.json"), "utf-8");
    const parsed = JSON.parse(written);

    expect(parsed.suite).toBe("cli-pass");
    expect(parsed.gatePassed).toBe(true);
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0].caseId).toBe("basic");
  });

  it("loads suite from the real fixture file", async () => {
    const fixturePath = resolve(
      import.meta.dirname,
      "..",
      "fixtures",
      "suites",
      "smoke.json",
    );

    const { report, exitCode } = await runCli({
      suitePath: fixturePath,
      outputDir,
      judge: createMockJudge(),
    });

    expect(exitCode).toBe(0);
    expect(report.gatePassed).toBe(true);
    expect(report.suite).toBe("smoke");
    expect(report.total).toBe(4);
  });
});

describe("toOutputReport()", () => {
  it("strips reply bodies and preserves scores", () => {
    const full: EvalReport = {
      suite: "test",
      total: 2,
      passed: 1,
      failed: 1,
      score: 0.5,
      passThreshold: 0.8,
      gatePassed: false,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      cases: [
        {
          caseId: "a",
          description: "case a",
          input: "secret input",
          reply: "secret reply that should not leak",
          pass: true,
          weight: 1,
          durationMs: 50,
          assertions: [{ kind: "contains", label: "x", pass: true }],
        },
        {
          caseId: "b",
          description: "case b",
          input: "more input",
          reply: "more reply",
          pass: false,
          weight: 1,
          durationMs: 30,
          assertions: [{ kind: "contains", label: "y", pass: false, message: "fail" }],
        },
      ],
    };

    const output = toOutputReport(full);

    expect(output.suite).toBe("test");
    expect(output.gatePassed).toBe(false);
    expect(output.score).toBe(0.5);
    expect(output.cases).toHaveLength(2);
    // Should NOT have reply or input fields
    expect((output.cases[0] as Record<string, unknown>)["reply"]).toBeUndefined();
    expect((output.cases[0] as Record<string, unknown>)["input"]).toBeUndefined();
    expect(output.cases[0]!.caseId).toBe("a");
    expect(output.cases[0]!.pass).toBe(true);
    expect(output.cases[0]!.durationMs).toBe(50);
  });
});

describe("createMockJudge()", () => {
  it("passes when reply is long enough", async () => {
    const judge = createMockJudge();
    const result = await judge.judge({
      criterion: "is empathetic",
      reply: "I understand how you feel and I'm here for you.",
      originalInput: "I feel sad",
    });
    expect(result.pass).toBe(true);
  });

  it("fails when reply is too short", async () => {
    const judge = createMockJudge();
    const result = await judge.judge({
      criterion: "is empathetic",
      reply: "ok",
      originalInput: "I feel sad",
    });
    expect(result.pass).toBe(false);
  });

  it("respects verdict overrides", async () => {
    const verdicts = new Map([["empathetic", false]]);
    const judge = createMockJudge({ verdicts });
    const result = await judge.judge({
      criterion: "reply is empathetic",
      reply: "A very long and detailed response that would normally pass.",
      originalInput: "x",
    });
    expect(result.pass).toBe(false);
    expect(result.rationale).toContain("override");
  });

  it("uses defaultPass option", async () => {
    const judge = createMockJudge({ defaultPass: false });
    const result = await judge.judge({
      criterion: "anything",
      reply: "A sufficiently long response here",
      originalInput: "x",
    });
    expect(result.pass).toBe(false);
  });
});
