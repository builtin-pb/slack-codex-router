import { describe, expect, it } from "vitest";
import { createRuntimeHarness } from "./helpers/runtime_harness.js";

describe("integrated runtime flow", () => {
  it("creates a thread mapping, starts a turn, and posts runtime output into the same slack thread", async () => {
    const harness = await createRuntimeHarness();

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        text: "Investigate the repo",
      });

      harness.emitNotification({
        method: "thread/status/changed",
        params: { threadId: "thread_abc", state: "running" },
      });
      harness.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: { type: "message", role: "assistant", text: "Working on it." },
        },
      });

      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        appServerThreadId: "thread_abc",
        activeTurnId: "turn_abc",
        state: "running",
      });
      expect(harness.slack.postedMessages.at(-1)).toMatchObject({
        channel: "C08TEMPLATE",
        thread_ts: "1710000000.0001",
        text: "Working on it.",
      });
    } finally {
      harness.cleanup();
    }
  });
});
