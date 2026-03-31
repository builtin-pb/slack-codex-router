import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeBranchToTarget } from "../../src/git/merge_to_main.js";
import { getRepositoryStatus } from "../../src/git/repository_status.js";
import { RouterStore } from "../../src/persistence/store.js";
import { RouterService } from "../../src/router/service.js";
import { createGitRepoFixture } from "../helpers/git_repo_fixture.js";

describe("real merge flow", () => {
  it("merges from repo root while the source branch is checked out in a linked worktree", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/merge-test" });
    const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0010",
      baseBranch: repo.defaultBranch,
    });

    await repo.commitFile(worktree.worktreePath, "feature.txt", "merged\n", "feature commit");
    await repo.mergeFromRoot({
      sourceBranch: worktree.branchName,
      targetBranch: repo.defaultBranch,
    });

    expect(await repo.fileContents(repo.repoPath, "feature.txt")).toBe("merged\n");
  });

  it("leaves persisted thread metadata unchanged when merge confirmation fails", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/conflict-test" });
    const store = new RouterStore(":memory:");
    const initialRecord = {
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0011",
      appServerThreadId: "thread_merge",
      activeTurnId: null,
      appServerSessionStale: false,
      state: "idle" as const,
      worktreePath: `${repo.repoPath}/.codex-worktrees/1710000000-0011`,
      branchName: "codex/slack/1710000000-0011",
      baseBranch: repo.defaultBranch,
    };
    store.upsertThread(initialRecord);

    const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0011",
      baseBranch: repo.defaultBranch,
    });
    await repo.commitFile(worktree.worktreePath, "merge.txt", "merge\n", "merge seed");

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: repo.projectsFile,
      store,
      threadStart: async () => ({ threadId: "thread_merge" }),
      turnStart: async () => ({ turnId: "turn_merge" }),
      getRepositoryStatus: async ({ repoPath, sourceBranch, targetBranch }) => {
        const status = await repo.statusPorcelain(repoPath);

        return {
          repositoryName: "template",
          sourceBranch,
          targetBranch,
          worktreeStatus: status.trim() ? "dirty" : "clean",
          checksStatus: "not run",
        };
      },
      executeMergeToMain: async ({ sourceBranch, targetBranch }) => {
        await repo.mergeFromRoot({ sourceBranch, targetBranch });
        return { text: "merged" };
      },
    });

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0011", {
        sourceBranch: "missing-source-branch",
        targetBranch: repo.defaultBranch,
      }),
    ).rejects.toThrow();

    expect(store.getThread("C08TEMPLATE", "1710000000.0011")).toEqual(initialRecord);
    store.close();
  });

  it("rejects dirty worktrees and dirty repo roots before allowing a real merge", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/dirty-merge-test" });
    const store = new RouterStore(":memory:");
    const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0012",
      baseBranch: repo.defaultBranch,
    });

    await repo.commitFile(
      worktree.worktreePath,
      "feature.txt",
      "real merge content\n",
      "feature merge seed",
    );

    const initialRecord = {
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0012",
      appServerThreadId: "thread_merge",
      activeTurnId: null,
      appServerSessionStale: false,
      state: "idle" as const,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      baseBranch: repo.defaultBranch,
    };
    store.upsertThread(initialRecord);

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: repo.projectsFile,
      store,
      threadStart: async () => ({ threadId: "thread_merge" }),
      turnStart: async () => ({ turnId: "turn_merge" }),
      getRepositoryStatus,
      executeMergeToMain: mergeBranchToTarget,
    });

    const dirtyWorktreeFile = `${worktree.worktreePath}/worktree-dirty.txt`;
    writeFileSync(dirtyWorktreeFile, "dirty worktree\n", "utf8");

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0012"),
    ).rejects.toThrow("This Slack thread has uncommitted changes and cannot be merged.");

    repo.removePath(dirtyWorktreeFile);

    const dirtyRootFile = `${repo.repoPath}/root-dirty.txt`;
    writeFileSync(dirtyRootFile, "dirty root\n", "utf8");

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0012"),
    ).rejects.toThrow("The repository root checkout has uncommitted changes and cannot be merged.");

    repo.removePath(dirtyRootFile);

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0012"),
    ).resolves.toEqual({
      text: `Merged ${worktree.branchName} into ${repo.defaultBranch}.`,
    });

    expect(await repo.fileContents(repo.repoPath, "feature.txt")).toBe("real merge content\n");
    expect(store.getThread("C08TEMPLATE", "1710000000.0012")).toEqual({
      ...initialRecord,
      worktreePath: repo.repoPath,
      branchName: repo.defaultBranch,
      appServerSessionStale: true,
      state: "idle",
    });

    store.close();
    repo.cleanup();
  });
});
