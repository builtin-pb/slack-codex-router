import { describe, expect, it } from "vitest";
import { recoverAfterRestart } from "../src/runtime/restart.js";

describe("recoverAfterRestart without a pending restart intent", () => {
  it("preserves the recovered thread count and leaves the recovery target unset", async () => {
    const result = await recoverAfterRestart({
      pendingRestartIntent: null,
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
        {
          slackChannelId: "C456",
          slackThreadTs: "1710000000.0002",
          appServerThreadId: "thread_def",
          state: "running",
          worktreePath: "/tmp/wt-2",
          branchName: "codex/slack/1710000000-0002",
          baseBranch: "main",
        },
      ],
    });

    expect(result.recoveredThreadCount).toBe(2);
    expect(result.notifyChannelId).toBeNull();
    expect(result.notifyThreadTs).toBeNull();
  });
});
