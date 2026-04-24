import { describe, it, expect } from "vitest";
describe("package loads", () => {
  it("exports", async () => {
    const mod = await import("../src/index.js");
    expect(mod).toBeDefined();
  });
});
