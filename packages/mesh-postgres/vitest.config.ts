import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: process.env.SKIP_INTEGRATION
      ? ["test/smoke.test.ts", "test/conversation-memory.test.ts"]
      : ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      // Colima (and some other rootless Docker setups) can't bind-mount the
      // docker socket into testcontainers' Ryuk reaper. Disable Ryuk; the
      // containers are cleaned up by afterAll anyway.
      TESTCONTAINERS_RYUK_DISABLED: "true",
    },
  },
});
