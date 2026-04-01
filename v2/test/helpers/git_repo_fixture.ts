import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { WorktreeManager, buildWorktreePath } from "../../src/worktree/manager.js";

const execFileAsync = promisify(execFile);

type GitRepoFixtureOptions = {
  divergedBranch?: string;
};

export async function createGitRepoFixture(options: GitRepoFixtureOptions = {}) {
  const repoPath = mkdtempSync(join(tmpdir(), "router-real-git-"));
  const defaultBranch = "main";
  const projectsFile = join(repoPath, "projects.yaml");
  const routerStateDb = join(repoPath, "router.sqlite3");

  await execFileAsync("git", ["init"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.name", "Router Tests"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.email", "router-tests@example.com"], {
    cwd: repoPath,
  });
  await execFileAsync("git", ["checkout", "-b", defaultBranch], { cwd: repoPath });

  writeFileSync(join(repoPath, "README.md"), "# temp repo\n", "utf8");
  writeFileSync(
    projectsFile,
    [
      "projects:",
      "  - channel_id: C08TEMPLATE",
      "    name: template",
      `    path: ${JSON.stringify(repoPath)}`,
    ].join("\n"),
    "utf8",
  );

  await execFileAsync("git", ["add", "README.md", "projects.yaml"], { cwd: repoPath });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoPath });

  if (options.divergedBranch) {
    await execFileAsync("git", ["checkout", "-b", options.divergedBranch], { cwd: repoPath });
    writeFileSync(join(repoPath, "branch.txt"), `${options.divergedBranch}\n`, "utf8");
    await execFileAsync("git", ["add", "branch.txt"], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-m", "diverge"], { cwd: repoPath });
    await execFileAsync("git", ["checkout", defaultBranch], { cwd: repoPath });
  }

  return {
    repoPath,
    routerStateDb,
    projectsFile,
    defaultBranch,
    cleanup() {
      rmSync(repoPath, { recursive: true, force: true });
    },
    buildWorktreePath(threadTs: string) {
      return buildWorktreePath(repoPath, threadTs);
    },
    async revParse(ref: string) {
      const result = await execFileAsync("git", ["rev-parse", ref], { cwd: repoPath });
      return result.stdout.trim();
    },
    async revParseHead(cwd: string) {
      const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
      return result.stdout.trim();
    },
    async currentBranch(cwd: string) {
      const result = await execFileAsync("git", ["branch", "--show-current"], { cwd });
      return result.stdout.trim();
    },
    async checkout(cwd: string, branch: string) {
      await execFileAsync("git", ["checkout", branch], { cwd });
    },
    async createBranch(cwd: string, branch: string) {
      await execFileAsync("git", ["checkout", "-b", branch], { cwd });
    },
    async statusPorcelain(cwd: string) {
      const result = await execFileAsync("git", ["status", "--porcelain"], { cwd });
      return result.stdout;
    },
    async createNonEmptyDirectory(path: string) {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "placeholder.txt"), "occupied\n", "utf8");
    },
    removePath(path: string) {
      rmSync(path, { recursive: true, force: true });
    },
    async commitFile(cwd: string, relativePath: string, contents: string, message: string) {
      writeFileSync(join(cwd, relativePath), contents, "utf8");
      await execFileAsync("git", ["add", relativePath], { cwd });
      await execFileAsync("git", ["commit", "-m", message], { cwd });
    },
    async mergeFromRoot(input: { sourceBranch: string; targetBranch: string }) {
      await execFileAsync("git", ["checkout", input.targetBranch], { cwd: repoPath });
      await execFileAsync("git", ["merge", "--no-ff", "--no-edit", input.sourceBranch], {
        cwd: repoPath,
      });
    },
    async fileContents(cwd: string, relativePath: string) {
      return readFileSync(join(cwd, relativePath), "utf8");
    },
    async showFile(ref: string, relativePath: string) {
      const result = await execFileAsync("git", ["show", `${ref}:${relativePath}`], {
        cwd: repoPath,
      });
      return result.stdout;
    },
    createWorktreeManager() {
      return new WorktreeManager({
        pathExists: existsSync,
        run: async ({ args, cwd }) => {
          await execFileAsync("git", args, { cwd });
        },
      });
    },
  };
}
