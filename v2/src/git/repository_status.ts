import { execFileSync } from "node:child_process";
import { basename, sep } from "node:path";

export type RepositoryStatus = {
  repositoryName: string;
  sourceBranch: string;
  targetBranch: string;
  worktreeStatus: "clean" | "dirty";
  checksStatus: string;
};

export type RepositoryStatusRunner = (input: {
  args: string[];
  cwd: string;
}) => Promise<{ stdout: string }>;

export async function getRepositoryStatus(input: {
  repoPath: string;
  sourceBranch?: string;
  branchName?: string;
  targetBranch: string;
  run?: RepositoryStatusRunner;
}): Promise<RepositoryStatus> {
  const run =
    input.run ??
    (async ({ args, cwd }: { args: string[]; cwd: string }) => ({
      stdout: execFileSync("git", args, {
        cwd,
        encoding: "utf8",
      }),
    }));
  const status = await run({
    args: ["status", "--porcelain"],
    cwd: input.repoPath,
  });

  return {
    repositoryName: deriveRepositoryName(input.repoPath),
    sourceBranch: input.sourceBranch ?? input.branchName ?? "",
    targetBranch: input.targetBranch,
    worktreeStatus: status.stdout.trim() ? "dirty" : "clean",
    checksStatus: "not run",
  };
}

function deriveRepositoryName(repoPath: string): string {
  const parts = repoPath.split(sep).filter(Boolean);
  const worktreeIndex = parts.lastIndexOf(".codex-worktrees");
  if (worktreeIndex > 0) {
    return parts[worktreeIndex - 1] ?? basename(repoPath);
  }

  return basename(repoPath);
}
