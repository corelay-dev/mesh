import { describe, it, expect } from "vitest";
import { version } from "../src/index.js";

describe("@corelay/mesh-core", () => {
  it("exposes a version string", () => {
    expect(version).toBe("0.0.1");
  });
});
