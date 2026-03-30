import { describe, expect, it } from "vitest";
import { RESTART_EXIT_CODE } from "../../src/runtime/restart.js";
import { createRealAppServerHarness } from "../helpers/real_app_server_harness.js";

describe("real restart recovery", () => {
  it("creates a thread on boot 1, requests restart, reboots against the same db, and rebinds the first post-restart reply", async () => {
    const harness = await createRealAppServerHarness({
      scenario: "happy-path",
      persistentStore: true,
    });

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        text: "Investigate the repo",
      });

      await harness.dispatchAction("restart_router", {
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      const beforeRestart = harness.store.getThread("C08TEMPLATE", "1710000000.0001")!;
      expect(harness.processExitCodes).toContain(RESTART_EXIT_CODE);

      await harness.bootNextGeneration();

      expect(harness.slack.postedMessages.at(-1)).toMatchObject({
        thread_ts: "1710000000.0001",
        text: expect.stringContaining("Router restarted."),
      });

      await harness.dispatchThreadReply({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0002",
        thread_ts: "1710000000.0001",
        text: "continue",
      });

      const reboundThreadStart = await harness.waitForRequest("thread/start", {
        occurrence: 2,
      });
      const reboundTurnStart = await harness.waitForRequest("turn/start", {
        occurrence: 2,
      });
      const afterRestart = harness.store.getThread("C08TEMPLATE", "1710000000.0001")!;

      expect(reboundThreadStart).toBeTruthy();
      expect(reboundTurnStart).toMatchObject({
        params: {
          threadId: afterRestart.appServerThreadId,
        },
      });
      expect(afterRestart.appServerThreadId).not.toBe(beforeRestart.appServerThreadId);
      expect(afterRestart).toMatchObject({
        appServerSessionStale: false,
        state: "running",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rolls back thread state when the child exits during turn/start", async () => {
    const harness = await createRealAppServerHarness({
      scenario: "exit-during-turn-start",
    });

    try {
      await expect(
        harness.dispatchTopLevelMessage({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0009",
          text: "Investigate the repo",
        }),
      ).rejects.toThrow();

      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0009")).toMatchObject({
        state: "failed_setup",
      });
    } finally {
      await harness.cleanup();
    }
  });
});
