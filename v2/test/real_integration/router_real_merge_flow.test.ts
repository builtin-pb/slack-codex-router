import { describe, expect, it } from "vitest";
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
    const store = new RouterStore(repo.routerStateDb);
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
});
