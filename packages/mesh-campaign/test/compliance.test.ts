import { describe, it, expect } from "vitest";
import { runStaticChecks } from "../src/compliance/rules.js";

describe("compliance/rules", () => {
  it("detects banned hate speech terms", () => {
    const issues = runStaticChecks("We will destroy them all", []);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("destroy them");
  });

  it("detects electoral violations", () => {
    const issues = runStaticChecks("INEC is corrupt and rigged", []);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("Electoral Act");
  });

  it("detects campaign-specific donts", () => {
    const issues = runStaticChecks(
      "Our opponent failed at education reform completely",
      ["Do not attack opponent on education policy"],
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("campaign rule");
  });

  it("passes clean content", () => {
    const issues = runStaticChecks(
      "Our candidate has a strong track record on infrastructure development in Lagos State.",
      ["Do not mention religion"],
    );
    expect(issues).toHaveLength(0);
  });

  it("detects vote buying references", () => {
    const issues = runStaticChecks("Free money at the polling station for everyone", []);
    expect(issues.length).toBeGreaterThan(0);
  });
});
