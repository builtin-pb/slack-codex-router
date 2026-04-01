import { describe, expect, it, vi } from "vitest";
import {
  buildMergeConfirmation,
  mergeBranchToTarget,
} from "../src/git/merge_to_main.js";

describe("buildMergeConfirmation", () => {
  it("builds a confirmation card before merging to main", () => {
    const blocks = buildMergeConfirmation({
      repositoryName: "template",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      checksStatus: "passed",
      worktreeStatus: "clean",
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("Merge codex/slack/1710000000-0001 into main?"),
      },
    });
    expect(JSON.stringify(blocks)).toContain("template");
    expect(JSON.stringify(blocks)).toContain("passed");
    expect(JSON.stringify(blocks)).toContain("clean");
    expect(JSON.stringify(blocks)).toContain("Confirm merge");
    expect(JSON.stringify(blocks)).toContain("confirm_merge_to_main");
  });

  it("detects the original branch, merges on the target branch, and restores the original branch", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "feature/original\n" })
      .mockResolvedValue({ stdout: "" });

    const result = await mergeBranchToTarget({
      repoPath: "/repo/template/.codex-worktrees/1710000000-0001",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      run,
    });

    expect(run).toHaveBeenNthCalledWith(1, {
      args: ["branch", "--show-current"],
      cwd: "/repo/template/.codex-worktrees/1710000000-0001",
    });
    expect(run).toHaveBeenNthCalledWith(2, {
      args: ["checkout", "main"],
      cwd: "/repo/template/.codex-worktrees/1710000000-0001",
    });
    expect(run).toHaveBeenNthCalledWith(3, {
      args: ["merge", "--no-ff", "--no-edit", "codex/slack/1710000000-0001"],
      cwd: "/repo/template/.codex-worktrees/1710000000-0001",
    });
    expect(run).toHaveBeenNthCalledWith(4, {
      args: ["checkout", "feature/original"],
      cwd: "/repo/template/.codex-worktrees/1710000000-0001",
    });
    expect(result).toEqual({
      text: "Merged codex/slack/1710000000-0001 into main.",
    });
  });

  it("restores a detached HEAD after a successful merge", async () => {
    const detachedHead = "abc123def456";
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "\n" })
      .mockResolvedValueOnce({ stdout: `${detachedHead}\n` })
      .mockResolvedValue({ stdout: "" });

    const result = await mergeBranchToTarget({
      repoPath: "/repo/template",
      sourceBranch: "codex/slack/1710000000-0002",
      targetBranch: "main",
      run,
    });

    expect(run).toHaveBeenNthCalledWith(1, {
      args: ["branch", "--show-current"],
      cwd: "/repo/template",
    });
    expect(run).toHaveBeenNthCalledWith(2, {
      args: ["rev-parse", "HEAD"],
      cwd: "/repo/template",
    });
    expect(run).toHaveBeenNthCalledWith(3, {
      args: ["checkout", "main"],
      cwd: "/repo/template",
    });
    expect(run).toHaveBeenNthCalledWith(4, {
      args: ["merge", "--no-ff", "--no-edit", "codex/slack/1710000000-0002"],
      cwd: "/repo/template",
    });
    expect(run).toHaveBeenNthCalledWith(5, {
      args: ["checkout", detachedHead],
      cwd: "/repo/template",
    });
    expect(result).toEqual({
      text: "Merged codex/slack/1710000000-0002 into main.",
    });
  });
});
