import { describe, expect, it } from "vitest";
import { recoverAfterRestart } from "../src/runtime/restart.js";

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
