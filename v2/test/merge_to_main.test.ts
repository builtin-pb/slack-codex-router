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

  it("checks out the target branch and merges the source branch", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "" });

    const result = await mergeBranchToTarget({
      repoPath: "/repo/template/.codex-worktrees/1710000000-0001",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      run,
    });

    expect(run).toHaveBeenNthCalledWith(1, {
      args: ["checkout", "main"],
      cwd: "/repo/template/.codex-worktrees/1710000000-0001",
    });
    expect(run).toHaveBeenNthCalledWith(2, {
      args: ["merge", "--no-ff", "--no-edit", "codex/slack/1710000000-0001"],
      cwd: "/repo/template/.codex-worktrees/1710000000-0001",
    });
    expect(result).toEqual({
      text: "Merged codex/slack/1710000000-0001 into main.",
    });
  });
});
