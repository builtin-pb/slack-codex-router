import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { RouterStore } from "../src/persistence/store.js";

describe("RouterStore", () => {
  it("persists thread routing, worktree, and restart metadata by composite thread identity", () => {
    const store = new RouterStore(":memory:");

    store.upsertThread({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_abc",
      activeTurnId: "turn_abc",
      state: "running",
      worktreePath: "/tmp/router/wt-1",
      branchName: "codex/slack/1710000000.0001",
      baseBranch: "main",
    });

    store.upsertThread({
      slackChannelId: "C999",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_xyz",
      activeTurnId: null,
      state: "running",
      worktreePath: "/tmp/router/wt-2",
      branchName: "codex/slack/1710000000.0001-alt",
      baseBranch: "main",
    });

    store.recordRestartIntent({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });

    const thread = store.getThread("C123", "1710000000.0001");
    const otherThread = store.getThread("C999", "1710000000.0001");
    const restart = store.getPendingRestartIntent();

    expect(thread?.appServerThreadId).toBe("thread_abc");
    expect(thread?.activeTurnId).toBe("turn_abc");
    expect(thread?.branchName).toBe("codex/slack/1710000000.0001");
    expect(thread?.worktreePath).toBe("/tmp/router/wt-1");
    expect(otherThread?.appServerThreadId).toBe("thread_xyz");
    expect(otherThread?.activeTurnId).toBeNull();
    expect(restart?.slackChannelId).toBe("C123");
    expect(restart?.slackThreadTs).toBe("1710000000.0001");
    expect(restart?.requestedAt).toBe("2026-03-30T12:00:00Z");
  });

  it("returns recoverable threads and clears restart intent", () => {
    const store = new RouterStore(":memory:");

    store.upsertThread({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_abc",
      activeTurnId: "turn_abc",
      state: "running",
      worktreePath: "/tmp/router/wt-1",
      branchName: "codex/slack/1710000000.0001",
      baseBranch: "main",
    });
    store.upsertThread({
      slackChannelId: "C456",
      slackThreadTs: "1710000000.0002",
      appServerThreadId: "thread_def",
      activeTurnId: null,
      state: "failed_setup",
      worktreePath: "/tmp/router/wt-2",
      branchName: "codex/slack/1710000000.0002",
      baseBranch: "main",
    });
    store.recordRestartIntent({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });

    const recoverable = store.listRecoverableThreads();
    store.clearRestartIntent();

    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]?.slackChannelId).toBe("C123");
    expect(recoverable[0]?.slackThreadTs).toBe("1710000000.0001");
    expect(recoverable[0]?.activeTurnId).toBe("turn_abc");
    expect(store.getPendingRestartIntent()).toBeNull();
  });

  it("persists data across store recreation on disk", () => {
    const databaseDir = mkdtempSync(join(tmpdir(), "router-store-"));
    const databasePath = join(databaseDir, "state.sqlite3");

    try {
      const firstStore = new RouterStore(databasePath);
      firstStore.upsertThread({
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0001",
        appServerThreadId: "thread_abc",
        activeTurnId: "turn_abc",
        state: "running",
        worktreePath: "/tmp/router/wt-1",
        branchName: "codex/slack/1710000000.0001",
        baseBranch: "main",
      });
      firstStore.recordRestartIntent({
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0001",
        requestedAt: "2026-03-30T12:00:00Z",
      });
      firstStore.close();

      const secondStore = new RouterStore(databasePath);
      try {
        const thread = secondStore.getThread("C123", "1710000000.0001");
        const restart = secondStore.getPendingRestartIntent();

        expect(thread?.appServerThreadId).toBe("thread_abc");
        expect(thread?.activeTurnId).toBe("turn_abc");
        expect(thread?.worktreePath).toBe("/tmp/router/wt-1");
        expect(restart?.slackChannelId).toBe("C123");
        expect(restart?.slackThreadTs).toBe("1710000000.0001");
      } finally {
        secondStore.close();
      }
    } finally {
      rmSync(databaseDir, { recursive: true, force: true });
    }
  });

  it("creates missing parent directories for on-disk sqlite databases", () => {
    const databaseDir = mkdtempSync(join(tmpdir(), "router-store-nested-"));
    const databasePath = join(databaseDir, "nested", "router", "state.sqlite3");

    try {
      const store = new RouterStore(databasePath);

      try {
        store.upsertThread({
          slackChannelId: "C123",
          slackThreadTs: "1710000000.0001",
          appServerThreadId: "thread_abc",
          activeTurnId: "turn_abc",
          state: "running",
          worktreePath: "/tmp/router/wt-1",
          branchName: "codex/slack/1710000000.0001",
          baseBranch: "main",
        });

        expect(existsSync(dirname(databasePath))).toBe(true);
        expect(store.getThread("C123", "1710000000.0001")?.appServerThreadId).toBe(
          "thread_abc",
        );
        expect(store.getThread("C123", "1710000000.0001")?.activeTurnId).toBe(
          "turn_abc",
        );
      } finally {
        store.close();
      }
    } finally {
      rmSync(databaseDir, { recursive: true, force: true });
    }
  });
});
