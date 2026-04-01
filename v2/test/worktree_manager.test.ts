import { describe, expect, it, vi } from "vitest";
import {
  buildBranchName,
  buildWorktreePath,
  WorktreeManager,
} from "../src/worktree/manager.js";

describe("WorktreeManager", () => {
  it("allocates one named branch per top-level Slack thread", () => {
    expect(buildBranchName("1710000000.0001")).toBe("codex/slack/1710000000-0001");
  });

  it("builds a deterministic worktree path under .codex-worktrees", () => {
    expect(buildWorktreePath("/repo/project", "1710000000.0001")).toBe(
      "/repo/project/.codex-worktrees/1710000000-0001",
    );
  });

  it("creates a worktree from the base branch when none exists yet", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const manager = new WorktreeManager({
      pathExists: () => false,
      run,
    });

    const result = await manager.ensureThreadWorktree({
      repoPath: "/repo/project",
      slackThreadTs: "1710000000.0001",
      baseBranch: "main",
    });

    expect(result).toEqual({
      worktreePath: "/repo/project/.codex-worktrees/1710000000-0001",
      branchName: "codex/slack/1710000000-0001",
    });
    expect(run).toHaveBeenCalledWith({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/slack/1710000000-0001",
        "/repo/project/.codex-worktrees/1710000000-0001",
        "main",
      ],
      cwd: "/repo/project",
    });
  });

  it("reuses a pre-existing worktree path instead of failing replay after a crash window", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const manager = new WorktreeManager({
      pathExists: () => true,
      run,
    });

    await expect(
      manager.ensureThreadWorktree({
        repoPath: "/repo/project",
        slackThreadTs: "1710000000.0007",
        baseBranch: "main",
      }),
    ).resolves.toEqual({
      worktreePath: "/repo/project/.codex-worktrees/1710000000-0007",
      branchName: "codex/slack/1710000000-0007",
    });

    expect(run).not.toHaveBeenCalled();
  });

  it("treats an already-created worktree as success when another caller wins the race", async () => {
    let exists = false;
    const run = vi.fn().mockImplementation(async () => {
      exists = true;
      throw new Error("fatal: '.codex-worktrees/1710000000-0001' already exists");
    });
    const manager = new WorktreeManager({
      pathExists: () => exists,
      run,
    });

    await expect(
      manager.ensureThreadWorktree({
        repoPath: "/repo/project",
        slackThreadTs: "1710000000.0001",
        baseBranch: "main",
      }),
    ).resolves.toEqual({
      worktreePath: "/repo/project/.codex-worktrees/1710000000-0001",
      branchName: "codex/slack/1710000000-0001",
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still fails when the path appears but the git error is unrelated to an existing worktree race", async () => {
    let exists = false;
    const run = vi.fn().mockImplementation(async () => {
      exists = true;
      throw new Error("fatal: could not lock config file");
    });
    const manager = new WorktreeManager({
      pathExists: () => exists,
      run,
    });

    await expect(
      manager.ensureThreadWorktree({
        repoPath: "/repo/project",
        slackThreadTs: "1710000000.0001",
        baseBranch: "main",
      }),
    ).rejects.toThrow("fatal: could not lock config file");
  });

  it("does not accept a branch-exists error as successful concurrent creation just because the target path exists", async () => {
    let exists = false;
    const run = vi.fn().mockImplementation(async () => {
      exists = true;
      throw new Error("fatal: a branch named 'codex/slack/1710000000-0008' already exists");
    });
    const manager = new WorktreeManager({
      pathExists: () => exists,
      run,
    });

    await expect(
      manager.ensureThreadWorktree({
        repoPath: "/repo/project",
        slackThreadTs: "1710000000.0008",
        baseBranch: "main",
      }),
    ).rejects.toThrow("branch named 'codex/slack/1710000000-0008' already exists");

    expect(run).toHaveBeenCalledTimes(1);
  });
});
