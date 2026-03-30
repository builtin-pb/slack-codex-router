import { describe, expect, it } from "vitest";
import { createRuntimeHarness } from "./helpers/runtime_harness.js";

describe("runtime harness", () => {
  it("boots a real router stack and exposes registered message handlers", async () => {
    const harness = await createRuntimeHarness();

    try {
      expect(harness.slack.messageHandler).toBeTypeOf("function");
      expect(harness.routerService).toBeDefined();
      expect(harness.store).toBeDefined();
    } finally {
      harness.cleanup();
    }
  });
});
