import { describe, it, expect } from "vitest";

describe("@corelay/mesh-coordination", () => {
  it("package loads", async () => {
    const mod = await import("../src/index.js");
    expect(mod).toBeDefined();
  });
});
