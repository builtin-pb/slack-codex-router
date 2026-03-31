import { afterEach, describe, expect, it, vi } from "vitest";

describe("getRepositoryStatus default runner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses execFileSync when no custom runner is provided", async () => {
    const execFileSync = vi.fn(() => "");

    vi.doMock("node:child_process", () => ({
      execFileSync,
    }));

    const { getRepositoryStatus } = await import("../src/git/repository_status.js");

    const status = await getRepositoryStatus({
      repoPath: "/repo/template",
      targetBranch: "main",
    });

    expect(execFileSync).toHaveBeenCalledWith("git", ["status", "--porcelain"], {
      cwd: "/repo/template",
      encoding: "utf8",
    });
    expect(status).toMatchObject({
      repositoryName: "template",
      sourceBranch: "",
      targetBranch: "main",
      worktreeStatus: "clean",
      checksStatus: "not run",
    });
  });
});
