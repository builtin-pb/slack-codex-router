import { afterEach, describe, expect, it } from "vitest";
import { createGitRepoFixture } from "../helpers/git_repo_fixture.js";

describe("WorktreeManager real git", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("creates a real worktree from the requested base branch tip", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "release/test-base" });
    cleanups.push(repo.cleanup);

    const manager = repo.createWorktreeManager();
    const result = await manager.ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0002",
      baseBranch: "release/test-base",
    });

    expect(await repo.currentBranch(result.worktreePath)).toBe(
      "codex/slack/1710000000-0002",
    );
    expect(await repo.revParseHead(result.worktreePath)).toBe(
      await repo.revParse("release/test-base"),
    );
  });

  it("fails when the base branch does not exist", async () => {
    const repo = await createGitRepoFixture();
    cleanups.push(repo.cleanup);

    await expect(
      repo.createWorktreeManager().ensureThreadWorktree({
        repoPath: repo.repoPath,
        slackThreadTs: "1710000000.0003",
        baseBranch: "missing-branch",
      }),
    ).rejects.toThrow();
  });

  it("fails when the old worktree path is gone but the branch still exists", async () => {
    const repo = await createGitRepoFixture();
    cleanups.push(repo.cleanup);

    const manager = repo.createWorktreeManager();
    const first = await manager.ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0005",
      baseBranch: repo.defaultBranch,
    });

    repo.removePath(first.worktreePath);

    await expect(
      manager.ensureThreadWorktree({
        repoPath: repo.repoPath,
        slackThreadTs: "1710000000.0005",
        baseBranch: repo.defaultBranch,
      }),
    ).rejects.toThrow();
  });

  it("shows that linked worktrees dirty the root checkout", async () => {
    const repo = await createGitRepoFixture();
    cleanups.push(repo.cleanup);

    await repo.createWorktreeManager().ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0006",
      baseBranch: repo.defaultBranch,
    });

    expect(await repo.statusPorcelain(repo.repoPath)).toContain(".codex-worktrees/");
  });
});
