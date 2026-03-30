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
});
