import { describe, expect, it } from "vitest";
import { RESTART_EXIT_CODE, recoverAfterRestart, requestRouterRestart } from "../src/runtime/restart.js";
import { RouterStore } from "../src/persistence/store.js";

describe("requestRouterRestart", () => {
  it("records restart intent and returns the graceful restart exit code", async () => {
    const store = new RouterStore(":memory:");

    try {
      const result = await requestRouterRestart({
        store,
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0001",
        requestedAt: "2026-03-30T12:00:00Z",
      });

      expect(result).toEqual({ exitCode: RESTART_EXIT_CODE });
      expect(store.getPendingRestartIntent()).toEqual({
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0001",
        requestedAt: "2026-03-30T12:00:00Z",
      });
    } finally {
      store.close();
    }
  });
});

describe("recoverAfterRestart", () => {
  it("reloads persisted threads and posts a recovery update for the requesting Slack thread", async () => {
    const result = await recoverAfterRestart({
      pendingRestartIntent: {
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0001",
        requestedAt: "2026-03-30T12:00:00Z",
      },
      recoverableThreads: [
        {
          slackChannelId: "C123",
          slackThreadTs: "1710000000.0001",
          appServerThreadId: "thread_abc",
          state: "running",
          worktreePath: "/tmp/wt",
          branchName: "codex/slack/1710000000-0001",
          baseBranch: "main",
        },
      ],
    });

    expect(result.recoveredThreadCount).toBe(1);
    expect(result.notifyThreadTs).toBe("1710000000.0001");
    expect(result.notifyChannelId).toBe("C123");
  });
});
