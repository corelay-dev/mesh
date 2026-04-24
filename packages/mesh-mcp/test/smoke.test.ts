import { describe, it, expect } from "vitest";

describe("@corelay/mesh-mcp", () => {
  it("package loads", async () => {
    const mod = await import("../src/index.js");
    expect(mod).toBeDefined();
    expect(typeof mod.McpServer).toBe("function");
    expect(typeof mod.stdioTransport).toBe("function");
    expect(typeof mod.mcpToolFromAgent).toBe("function");
  });
});
