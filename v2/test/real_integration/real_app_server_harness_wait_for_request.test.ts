import { describe, expect, it } from "vitest";
import { createRealAppServerHarness } from "../helpers/real_app_server_harness.js";

describe("real app server harness request waiting", () => {
  it("reads the request log through waitForRequest without shadowing the helper", async () => {
    const harness = await createRealAppServerHarness({
      scenario: "happy-path",
    });

    try {
      const initializeRequest = await harness.waitForRequest("initialize");

      expect(initializeRequest).toMatchObject({
        method: "initialize",
      });
      expect(harness.readRequests()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "initialize",
          }),
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  }, 15000);
});
