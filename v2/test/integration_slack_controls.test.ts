import { describe, expect, it } from "vitest";
import { createRuntimeHarness } from "./helpers/runtime_harness.js";

describe("integrated slack controls", () => {
  it("registers live slack actions that operate on real persisted thread state", async () => {
    const harness = await createRuntimeHarness({ seedThread: true });

    try {
      await harness.dispatchAction("status", {
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses[0]).toMatchObject({
        text: expect.stringContaining("State: idle"),
      });
    } finally {
      harness.cleanup();
    }
  });
});
