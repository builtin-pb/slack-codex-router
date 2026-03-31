import { describe, expect, it, vi } from "vitest";
import { getRepositoryStatus } from "../src/git/repository_status.js";

describe("getRepositoryStatus", () => {
  it("reports repository identity, branches, and a clean worktree by default", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "" });

    const status = await getRepositoryStatus({
      repoPath: "/repo/template/.codex-worktrees/1710000000-0001",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      run,
    });

    expect(run).toHaveBeenCalledWith({
      args: ["status", "--porcelain"],
      cwd: "/repo/template/.codex-worktrees/1710000000-0001",
    });
    expect(status).toEqual({
      repositoryName: "template",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      worktreeStatus: "clean",
      checksStatus: "not run",
    });
  });

  it("marks the worktree dirty when git status reports changes", async () => {
    const status = await getRepositoryStatus({
      repoPath: "/repo/template",
      sourceBranch: "feature/test",
      targetBranch: "main",
      run: vi.fn().mockResolvedValue({ stdout: " M README.md\n" }),
    });

    expect(status.worktreeStatus).toBe("dirty");
  });

  it("ignores administrative .codex-worktrees entries in repo-root status", async () => {
    const status = await getRepositoryStatus({
      repoPath: "/repo/template",
      sourceBranch: "feature/test",
      targetBranch: "main",
      run: vi.fn().mockResolvedValue({ stdout: "?? .codex-worktrees/\n" }),
    });

    expect(status.worktreeStatus).toBe("clean");
  });

  it("still marks the repo dirty when real file changes exist beside .codex-worktrees", async () => {
    const status = await getRepositoryStatus({
      repoPath: "/repo/template",
      sourceBranch: "feature/test",
      targetBranch: "main",
      run: vi.fn().mockResolvedValue({ stdout: "?? .codex-worktrees/\n M README.md\n" }),
    });

    expect(status.worktreeStatus).toBe("dirty");
  });

  it("does not ignore tracked changes under .codex-worktrees", async () => {
    const status = await getRepositoryStatus({
      repoPath: "/repo/template",
      sourceBranch: "feature/test",
      targetBranch: "main",
      run: vi.fn().mockResolvedValue({ stdout: "D  .codex-worktrees/1710000000-0001/info.txt\n" }),
    });

    expect(status.worktreeStatus).toBe("dirty");
  });

  it("falls back to branchName when sourceBranch is absent", async () => {
    const status = await getRepositoryStatus({
      repoPath: "/repo/template",
      branchName: "feature/from-thread",
      targetBranch: "main",
      run: vi.fn().mockResolvedValue({ stdout: "" }),
    });

    expect(status.sourceBranch).toBe("feature/from-thread");
  });
});
