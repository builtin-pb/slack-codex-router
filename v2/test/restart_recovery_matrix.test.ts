import { describe, expect, it } from "vitest";
import { recoverAfterRestart } from "../src/runtime/restart.js";
import { RouterStore } from "../src/persistence/store.js";

describe("recoverAfterRestart matrix", () => {
  it("keeps idle threads idle, interrupts active threads, clears turns, and marks recovered rows stale", async () => {
    const result = await recoverAfterRestart({
      pendingRestartIntent: {
        slackChannelId: "C08TEMPLATE",
        slackThreadTs: "1710000000.0009",
        requestedAt: "2026-03-30T00:00:00.000Z",
      },
      recoverableThreads: [
        {
          slackChannelId: "C08TEMPLATE",
          slackThreadTs: "idle-thread",
          appServerThreadId: "thread_idle",
          activeTurnId: "turn_idle",
          appServerSessionStale: false,
          state: "idle",
          worktreePath: "/repo/worktree-idle",
          branchName: "main",
          baseBranch: "main",
        },
        {
          slackChannelId: "C08TEMPLATE",
          slackThreadTs: "running-thread",
          appServerThreadId: "thread_running",
          activeTurnId: "turn_running",
          appServerSessionStale: false,
          state: "running",
          worktreePath: "/repo/worktree-running",
          branchName: "feature",
          baseBranch: "main",
        },
      ],
    });

    expect(result).toEqual({
      recoveredThreadCount: 2,
      notifyThreadTs: "1710000000.0009",
      notifyChannelId: "C08TEMPLATE",
      recoveredThreads: [
        {
          slackChannelId: "C08TEMPLATE",
          slackThreadTs: "idle-thread",
          appServerThreadId: "thread_idle",
          activeTurnId: null,
          appServerSessionStale: true,
          state: "idle",
          worktreePath: "/repo/worktree-idle",
          branchName: "main",
          baseBranch: "main",
        },
        {
          slackChannelId: "C08TEMPLATE",
          slackThreadTs: "running-thread",
          appServerThreadId: "thread_running",
          activeTurnId: null,
          appServerSessionStale: true,
          state: "interrupted",
          worktreePath: "/repo/worktree-running",
          branchName: "feature",
          baseBranch: "main",
        },
      ],
    });
  });

  it("overwrites the singleton restart intent with the latest request", () => {
    const store = new RouterStore(":memory:");

    try {
      store.recordRestartIntent({
        slackChannelId: "C08FIRST",
        slackThreadTs: "1710000000.0001",
        requestedAt: "2026-03-30T00:00:00.000Z",
      });
      store.recordRestartIntent({
        slackChannelId: "C08SECOND",
        slackThreadTs: "1710000000.0002",
        requestedAt: "2026-03-30T00:01:00.000Z",
      });

      expect(store.getPendingRestartIntent()).toEqual({
        slackChannelId: "C08SECOND",
        slackThreadTs: "1710000000.0002",
        requestedAt: "2026-03-30T00:01:00.000Z",
      });
    } finally {
      store.close();
    }
  });
});
