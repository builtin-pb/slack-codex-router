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
  const relevantStatusLines = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => !isAdministrativeWorktreeStatus(line));

  return {
    repositoryName: deriveRepositoryName(input.repoPath),
    sourceBranch: input.sourceBranch ?? input.branchName ?? "",
    targetBranch: input.targetBranch,
    worktreeStatus: relevantStatusLines.length > 0 ? "dirty" : "clean",
    checksStatus: "not run",
  };
}

function isAdministrativeWorktreeStatus(statusLine: string): boolean {
  const statusCode = statusLine.slice(0, 2);
  const path = statusLine.slice(3).trim();
  if (statusCode !== "??") {
    return false;
  }

  return (
    path === ".codex-worktrees" ||
    path.startsWith(".codex-worktrees/") ||
    path.startsWith(".codex-worktrees\\")
  );
}

function deriveRepositoryName(repoPath: string): string {
  const parts = repoPath.split(sep).filter(Boolean);
  const worktreeIndex = parts.lastIndexOf(".codex-worktrees");
  if (worktreeIndex > 0) {
    return parts[worktreeIndex - 1] ?? basename(repoPath);
  }

  return basename(repoPath);
}
