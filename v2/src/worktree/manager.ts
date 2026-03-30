import { join } from "node:path";

type RunCommandFn = (input: { args: string[]; cwd: string }) => Promise<void>;

export type EnsureThreadWorktreeInput = {
  repoPath: string;
  slackThreadTs: string;
  baseBranch: string;
};

type WorktreeManagerOptions = {
  pathExists?(path: string): boolean;
  run(input: { args: string[]; cwd: string }): Promise<void>;
};

export class WorktreeManager {
  private readonly pathExists: (path: string) => boolean;
  private readonly run: RunCommandFn;

  constructor(options: WorktreeManagerOptions) {
    this.pathExists = options.pathExists ?? (() => false);
    this.run = options.run;
  }

  async ensureThreadWorktree(
    input: EnsureThreadWorktreeInput,
  ): Promise<{ worktreePath: string; branchName: string }> {
    const branchName = buildBranchName(input.slackThreadTs);
    const worktreePath = buildWorktreePath(input.repoPath, input.slackThreadTs);

    if (!this.pathExists(worktreePath)) {
      try {
        await this.run({
          args: [
            "worktree",
            "add",
            "-b",
            branchName,
            worktreePath,
            input.baseBranch,
          ],
          cwd: input.repoPath,
        });
      } catch (error) {
        if (!this.pathExists(worktreePath)) {
          throw error;
        }
      }
    }

    return {
      worktreePath,
      branchName,
    };
  }
}

export function buildBranchName(threadTs: string): string {
  return `codex/slack/${threadTs.replace(/\./g, "-")}`;
}

export function buildWorktreePath(repoPath: string, threadTs: string): string {
  return join(repoPath, ".codex-worktrees", threadTs.replace(/\./g, "-"));
}
