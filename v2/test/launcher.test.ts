import { describe, expect, it } from "vitest";
import { buildLauncher } from "../src/runtime/launcher.js";

describe("buildLauncher", () => {
  it("restarts the worker after a requested graceful exit", async () => {
    const launches: string[] = [];
    const launcher = buildLauncher({
      spawnWorker: async () => {
        launches.push("worker");
        return {
          wait: async () =>
            launches.length === 1 ? 75 : 0,
        };
      },
    });

    await launcher.runOnce();

    expect(launches).toEqual(["worker", "worker"]);
  });
});
