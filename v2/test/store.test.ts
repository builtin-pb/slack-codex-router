import { describe, expect, it } from "vitest";
import { RouterStore } from "../src/persistence/store.js";

describe("RouterStore", () => {
  it("persists thread routing, worktree, and restart metadata", () => {
    const store = new RouterStore(":memory:");

    store.upsertThread({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_abc",
      state: "running",
      worktreePath: "/tmp/router/wt-1",
      branchName: "codex/slack/1710000000.0001",
      baseBranch: "main",
    });

    store.recordRestartIntent({
      requestedByThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });

    const thread = store.getThread("1710000000.0001");
    const restart = store.getPendingRestartIntent();

    expect(thread?.appServerThreadId).toBe("thread_abc");
    expect(thread?.branchName).toBe("codex/slack/1710000000.0001");
    expect(thread?.worktreePath).toBe("/tmp/router/wt-1");
    expect(restart?.requestedByThreadTs).toBe("1710000000.0001");
    expect(restart?.requestedAt).toBe("2026-03-30T12:00:00Z");
  });

  it("returns recoverable threads and clears restart intent", () => {
    const store = new RouterStore(":memory:");

    store.upsertThread({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_abc",
      state: "running",
      worktreePath: "/tmp/router/wt-1",
      branchName: "codex/slack/1710000000.0001",
      baseBranch: "main",
    });
    store.upsertThread({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0002",
      appServerThreadId: "thread_def",
      state: "failed_setup",
      worktreePath: "/tmp/router/wt-2",
      branchName: "codex/slack/1710000000.0002",
      baseBranch: "main",
    });
    store.recordRestartIntent({
      requestedByThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });

    const recoverable = store.listRecoverableThreads();
    store.clearRestartIntent();

    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]?.slackThreadTs).toBe("1710000000.0001");
    expect(store.getPendingRestartIntent()).toBeNull();
  });
});
