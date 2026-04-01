import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/real_integration/**/*.test.ts", "test/live_codex/**/*.test.ts"],
  },
});
