import { describe, expect, it } from "vitest";
import { createRealAppServerHarness } from "../helpers/real_app_server_harness.js";

describe("real app-server transport torture", () => {
  it("survives a noisy child that partially responds and then dies by recovering stale state on the next generation", async () => {
    const harness = await createRealAppServerHarness({
      scenario: "transport-torture",
      persistentStore: true,
      useRealGitRepo: true,
    });

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0600",
        text: "Investigate the repo",
      });

      expect(await harness.waitForSlackMessage()).toMatchObject({
        thread_ts: "1710000000.0600",
        text: "partial progress",
      });

      await waitFor(() => harness.processExitCodes.includes(23));

      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0600")).toMatchObject({
        state: "running",
        activeTurnId: "turn_noise",
      });

      await harness.bootNextGeneration();

      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0600")).toMatchObject({
        state: "interrupted",
        appServerSessionStale: true,
        activeTurnId: null,
      });
      expect(harness.readArtifacts()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "transport-torture", phase: "before-exit" }),
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for torture scenario condition.");
}
