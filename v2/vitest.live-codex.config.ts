import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/live_codex/**/*.test.ts"],
    testTimeout: 300_000,
  },
});
