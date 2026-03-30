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
});
