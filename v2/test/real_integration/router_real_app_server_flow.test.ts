import { describe, expect, it } from "vitest";
import { createRealAppServerHarness } from "../helpers/real_app_server_harness.js";

describe("router runtime with a real app-server child", () => {
  it("sends initialize/thread-start/turn-start over the real transport and receives stdout-driven notifications", async () => {
    const harness = await createRealAppServerHarness({ scenario: "happy-path" });

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        text: "Investigate the repo",
      });

      const initializeRequest = await harness.waitForRequest("initialize");
      const threadStartRequest = await harness.waitForRequest("thread/start");
      const turnStartRequest = await harness.waitForRequest("turn/start");
      const slackMessage = await harness.waitForSlackMessage();

      expect(initializeRequest).toMatchObject({
        method: "initialize",
        params: {
          clientInfo: {
            name: "slack-codex-router",
            version: "0.1.0",
          },
        },
      });
      expect(threadStartRequest).toMatchObject({
        method: "thread/start",
        params: {
          cwd: expect.stringContaining(".codex-worktrees/"),
        },
      });
      expect(turnStartRequest).toMatchObject({
        method: "turn/start",
        params: {
          cwd: expect.stringContaining(".codex-worktrees/"),
          threadId: "thread_abc",
          input: [{ type: "text", text: "Investigate the repo" }],
        },
      });
      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        state: "running",
        activeTurnId: "turn_abc",
      });
      expect(slackMessage).toMatchObject({
        thread_ts: "1710000000.0001",
        text: "Working on it.",
      });
      expect(harness.slack.postedMessages.at(-1)).toMatchObject({
        thread_ts: "1710000000.0001",
        text: "Working on it.",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("survives fragmented and coalesced stdout framing", async () => {
    const fragmented = await createRealAppServerHarness({ scenario: "fragmented-output" });
    const coalesced = await createRealAppServerHarness({ scenario: "coalesced-output" });

    try {
      await fragmented.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0002",
        text: "Investigate the repo",
      });
      await coalesced.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0003",
        text: "Investigate the repo",
      });

      const fragmentedTurnStart = await fragmented.waitForRequest("turn/start");
      const coalescedTurnStart = await coalesced.waitForRequest("turn/start");

      expect(fragmentedTurnStart).toMatchObject({
        method: "turn/start",
        params: {
          threadId: "thread_abc",
        },
      });
      expect(coalescedTurnStart).toMatchObject({
        method: "turn/start",
        params: {
          threadId: "thread_abc",
        },
      });
      expect(fragmented.store.getThread("C08TEMPLATE", "1710000000.0002")).toMatchObject({
        activeTurnId: "turn_abc",
      });
      expect(coalesced.store.getThread("C08TEMPLATE", "1710000000.0003")).toMatchObject({
        activeTurnId: "turn_abc",
      });
    } finally {
      await fragmented.cleanup();
      await coalesced.cleanup();
    }
  });
});
