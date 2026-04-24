import { describe, it, expect } from "vitest";
import { generateEvalSuite } from "../src/index.js";
import type { ComposeSpec } from "../src/index.js";

const spec: ComposeSpec = {
  intent: "Triage agent for survivors.",
  examples: [
    { input: "hi", desiredReply: "You're safe to talk here. What do you need?" },
    { input: "he hit me", desiredReply: "I believe you. I'm here to help." },
  ],
  guardrails: [
    "Never minimise the survivor's experience.",
    "Never ask why they haven't left.",
  ],
};

describe("generateEvalSuite()", () => {
  it("creates one case per worked example", () => {
    const suite = generateEvalSuite(spec, "triage");
    const exCases = suite.cases.filter((c) => c.tags?.includes("example"));
    expect(exCases).toHaveLength(2);
    expect(exCases[0]?.input).toBe("hi");
    expect(exCases[1]?.input).toBe("he hit me");
  });

  it("extracts keywords from desired replies as contains assertions", () => {
    const suite = generateEvalSuite(spec, "triage");
    const first = suite.cases[0]!;
    expect(first.assertions.length).toBeGreaterThan(0);
    expect(first.assertions[0]?.kind).toBe("contains");
  });

  it("creates guardrail cases as notContains assertions", () => {
    const suite = generateEvalSuite(spec, "triage");
    const gCases = suite.cases.filter((c) => c.tags?.includes("guardrail"));
    expect(gCases).toHaveLength(2);
    expect(gCases[0]?.assertions[0]?.kind).toBe("notContains");
  });

  it("sets passThreshold to 1.0", () => {
    const suite = generateEvalSuite(spec, "triage");
    expect(suite.passThreshold).toBe(1.0);
  });

  it("handles empty spec gracefully", () => {
    const suite = generateEvalSuite({ intent: "x" }, "empty");
    expect(suite.cases).toHaveLength(0);
  });

  it("tags all cases as auto-generated", () => {
    const suite = generateEvalSuite(spec, "triage");
    for (const c of suite.cases) {
      expect(c.tags).toContain("auto-generated");
    }
  });
});
