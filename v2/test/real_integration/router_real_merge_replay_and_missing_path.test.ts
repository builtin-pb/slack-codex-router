import { describe, expect, it, vi } from "vitest";
import { mergeBranchToTarget } from "../../src/git/merge_to_main.js";
import { getRepositoryStatus } from "../../src/git/repository_status.js";
import { RouterStore } from "../../src/persistence/store.js";
import { RouterService } from "../../src/router/service.js";
import { createGitRepoFixture } from "../helpers/git_repo_fixture.js";

function extractMergeSelection(
  blocks: Array<{ type?: string; elements?: Array<{ action_id?: string; value?: string }> }>,
): { promptId: number; sourceBranch: string; targetBranch: string } {
  const actionBlock = blocks.find((block) => block.type === "actions");
  const button = actionBlock?.elements?.find(
    (element) => element.action_id === "confirm_merge_to_main",
  );
  const value = button?.value ?? "";
  const firstSeparator = value.indexOf(":");
  const lastSeparator = value.lastIndexOf(":");
  const promptId = Number.parseInt(value.slice(0, firstSeparator), 10);

  if (
    !Number.isInteger(promptId) ||
    promptId <= 0 ||
    firstSeparator <= 0 ||
    lastSeparator <= firstSeparator ||
    lastSeparator >= value.length - 1
  ) {
    throw new Error(`Invalid merge confirmation payload: ${value}`);
  }

  return {
    promptId,
    sourceBranch: value.slice(firstSeparator + 1, lastSeparator),
    targetBranch: value.slice(lastSeparator + 1),
  };
}

describe("real merge replay and missing-path handling", () => {
  it("rejects a replayed merge confirmation after the thread has already returned to the base branch", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/replay-test" });
    const store = new RouterStore(":memory:");

    try {
      const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
        repoPath: repo.repoPath,
        slackThreadTs: "1710000000.0500",
        baseBranch: repo.defaultBranch,
      });
      await repo.commitFile(worktree.worktreePath, "feature.txt", "replay\n", "seed replay");

      store.upsertThread({
        slackChannelId: "C08TEMPLATE",
        slackThreadTs: "1710000000.0500",
        appServerThreadId: "thread_merge",
        activeTurnId: null,
        appServerSessionStale: false,
        state: "idle",
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        baseBranch: repo.defaultBranch,
      });

      const service = new RouterService({
        allowedUserId: "U123",
        projectsFile: repo.projectsFile,
        store,
        threadStart: async () => ({ threadId: "thread_merge" }),
        turnStart: async () => ({ turnId: "turn_merge" }),
        getRepositoryStatus,
        executeMergeToMain: mergeBranchToTarget,
      });

      const preview = await service.previewMergeToMain(
        "U123",
        "C08TEMPLATE",
        "1710000000.0500",
      );
      const selection = extractMergeSelection(preview.blocks as never);

      await expect(
        service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0500", selection),
      ).resolves.toEqual({
        text: `Merged ${worktree.branchName} into ${repo.defaultBranch}.`,
      });

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0500", selection),
    ).rejects.toThrow("This Slack thread needs a new message to refresh the Codex session.");
    } finally {
      store.close();
      repo.cleanup();
    }
  });

  it("leaves persisted thread metadata unchanged when the worktree path has been deleted before confirmation", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/missing-path" });
    const store = new RouterStore(":memory:");

    try {
      const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
        repoPath: repo.repoPath,
        slackThreadTs: "1710000000.0501",
        baseBranch: repo.defaultBranch,
      });
      await repo.commitFile(worktree.worktreePath, "feature.txt", "missing path\n", "seed missing");

      const initialRecord = {
        slackChannelId: "C08TEMPLATE",
        slackThreadTs: "1710000000.0501",
        appServerThreadId: "thread_merge",
        activeTurnId: null,
        appServerSessionStale: false,
        state: "idle" as const,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        baseBranch: repo.defaultBranch,
      };
      store.upsertThread(initialRecord);
      repo.removePath(worktree.worktreePath);

      const service = new RouterService({
        allowedUserId: "U123",
        projectsFile: repo.projectsFile,
        store,
        threadStart: async () => ({ threadId: "thread_merge" }),
        turnStart: async () => ({ turnId: "turn_merge" }),
        getRepositoryStatus,
        executeMergeToMain: mergeBranchToTarget,
      });

      await expect(
        service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0501"),
      ).rejects.toThrow();

      expect(store.getThread("C08TEMPLATE", "1710000000.0501")).toEqual(initialRecord);
    } finally {
      store.close();
      repo.cleanup();
    }
  });

  it("rejects an old merge confirmation after the thread leaves idle and returns on the same branch pair", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/stale-preview" });
    const store = new RouterStore(":memory:");

    try {
      const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
        repoPath: repo.repoPath,
        slackThreadTs: "1710000000.0502",
        baseBranch: repo.defaultBranch,
      });
      await repo.commitFile(
        worktree.worktreePath,
        "feature.txt",
        "stale preview\n",
        "seed stale preview",
      );

      store.upsertThread({
        slackChannelId: "C08TEMPLATE",
        slackThreadTs: "1710000000.0502",
        appServerThreadId: "thread_merge",
        activeTurnId: null,
        appServerSessionStale: false,
        state: "idle",
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        baseBranch: repo.defaultBranch,
      });

      const service = new RouterService({
        allowedUserId: "U123",
        projectsFile: repo.projectsFile,
        store,
        threadStart: async () => ({ threadId: "thread_merge" }),
        turnStart: async () => ({ turnId: "turn_merge" }),
        reviewStart: async () => ({ reviewId: "review_merge" }),
        getRepositoryStatus,
        executeMergeToMain: mergeBranchToTarget,
      });

      const preview = await service.previewMergeToMain(
        "U123",
        "C08TEMPLATE",
        "1710000000.0502",
      );
      const staleSelection = extractMergeSelection(preview.blocks as never);

      await service.startReview("U123", "C08TEMPLATE", "1710000000.0502");
      const runningRecord = store.getThread("C08TEMPLATE", "1710000000.0502")!;
      store.upsertThread({
        ...runningRecord,
        activeTurnId: null,
        state: "idle",
      });

      await expect(
        service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0502", staleSelection),
      ).rejects.toThrow("Merge confirmation is stale. Request a fresh merge preview.");
    } finally {
      store.close();
      repo.cleanup();
    }
  });

  it("rejects merge preview and confirmation after restart leaves the session stale", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/stale-restart" });
    const store = new RouterStore(":memory:");

    try {
      const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
        repoPath: repo.repoPath,
        slackThreadTs: "1710000000.0503",
        baseBranch: repo.defaultBranch,
      });
      await repo.commitFile(worktree.worktreePath, "feature.txt", "restart stale\n", "seed restart stale");

      store.upsertThread({
        slackChannelId: "C08TEMPLATE",
        slackThreadTs: "1710000000.0503",
        appServerThreadId: "thread_restart",
        activeTurnId: null,
        appServerSessionStale: true,
        state: "idle",
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        baseBranch: repo.defaultBranch,
      });

      const getRepositoryStatus = vi.fn();
      const executeMergeToMain = vi.fn();
      const service = new RouterService({
        allowedUserId: "U123",
        projectsFile: repo.projectsFile,
        store,
        threadStart: async () => ({ threadId: "thread_restart" }),
        turnStart: async () => ({ turnId: "turn_restart" }),
        getRepositoryStatus,
        executeMergeToMain,
      });

      await expect(
        service.previewMergeToMain("U123", "C08TEMPLATE", "1710000000.0503"),
      ).rejects.toThrow("This Slack thread needs a new message to refresh the Codex session.");
      await expect(
        service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0503"),
      ).rejects.toThrow("This Slack thread needs a new message to refresh the Codex session.");

      expect(getRepositoryStatus).not.toHaveBeenCalled();
      expect(executeMergeToMain).not.toHaveBeenCalled();
    } finally {
      store.close();
      repo.cleanup();
    }
  });
});
