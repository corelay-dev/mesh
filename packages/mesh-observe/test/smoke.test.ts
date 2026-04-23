import { describe, it, expect } from "vitest";

describe("@corelay/mesh-observe", () => {
  it("package loads", async () => {
    const mod = await import("../src/index.js");
    expect(mod).toBeDefined();
  });
});
