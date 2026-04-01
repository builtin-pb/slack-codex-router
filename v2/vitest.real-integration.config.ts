import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/real_integration/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
