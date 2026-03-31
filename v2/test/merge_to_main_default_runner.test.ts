import { afterEach, describe, expect, it, vi } from "vitest";

describe("mergeBranchToTarget default runner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses execFileSync for checkout and merge when no custom runner is provided", async () => {
    const execFileSync = vi.fn(() => "");

    vi.doMock("node:child_process", () => ({
      execFileSync,
    }));

    const { mergeBranchToTarget } = await import("../src/git/merge_to_main.js");

    const result = await mergeBranchToTarget({
      repoPath: "/repo/template",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
    });

    expect(execFileSync).toHaveBeenNthCalledWith(1, "git", ["checkout", "main"], {
      cwd: "/repo/template",
      encoding: "utf8",
    });
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "git",
      ["merge", "--no-ff", "--no-edit", "codex/slack/1710000000-0001"],
      {
        cwd: "/repo/template",
        encoding: "utf8",
      },
    );
    expect(result).toEqual({
      text: "Merged codex/slack/1710000000-0001 into main.",
    });
  });
});
