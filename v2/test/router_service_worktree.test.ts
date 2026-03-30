import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";

function createProjectRegistryFixture(baseBranch?: string): {
  cleanup(): void;
  projectDir: string;
  projectsFile: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-worktree-"));
  const projectDir = join(tempDir, "project");
  const projectsFile = join(tempDir, "projects.yaml");
  const baseBranchLine = baseBranch ? `    base_branch: ${baseBranch}\n` : "";

  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    projectsFile,
    `projects:\n  - channel_id: C08TEMPLATE\n    name: template\n    path: ${JSON.stringify(projectDir)}\n${baseBranchLine}`,
    "utf8",
  );

  return {
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    projectDir,
    projectsFile,
  };
}

describe("RouterService worktree routing", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("allocates a dedicated worktree for a top-level thread before starting the task", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_abc" });
    const worktreePath = join(
      fixture.projectDir,
      ".codex-worktrees",
      "1710000000-0001",
    );
    const ensureThreadWorktree = vi.fn().mockResolvedValue({
      worktreePath,
      branchName: "codex/slack/1710000000-0001",
    });
    const replies: string[] = [];

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
      ensureThreadWorktree,
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(ensureThreadWorktree).toHaveBeenCalledWith({
      repoPath: fixture.projectDir,
      slackThreadTs: "1710000000.0001",
      baseBranch: "main",
    });
    expect(threadStart).toHaveBeenCalledWith({
      cwd: worktreePath,
    });
    expect(turnStart).toHaveBeenCalledWith({
      cwd: worktreePath,
      prompt: "Investigate the failing tests",
      threadId: "thread_abc",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      state: "running",
      worktreePath,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });
    expect(replies).toEqual(["Started Codex task for project `template`."]);
  });

  it("reuses the stored worktree path and branch metadata when continuing a thread", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn();
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_resume" });
    const ensureThreadWorktree = vi.fn();
    const replies: string[] = [];
    const persistedWorktreePath = join(
      fixture.projectDir,
      ".codex-worktrees",
      "1710000000-0001",
    );

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      state: "idle",
      worktreePath: persistedWorktreePath,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
      ensureThreadWorktree,
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0002",
      threadTs: "1710000000.0001",
      text: "Use the narrower repro",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(ensureThreadWorktree).not.toHaveBeenCalled();
    expect(threadStart).not.toHaveBeenCalled();
    expect(turnStart).toHaveBeenCalledWith({
      cwd: persistedWorktreePath,
      prompt: "Use the narrower repro",
      threadId: "thread_existing",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_existing",
      state: "running",
      worktreePath: persistedWorktreePath,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });
    expect(replies).toEqual(["Continuing Codex task for project `template`."]);
  });

  it("uses a project-specific base branch for new thread allocation", async () => {
    const fixture = createProjectRegistryFixture("develop");
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_abc" });
    const ensureThreadWorktree = vi.fn().mockResolvedValue({
      worktreePath: join(
        fixture.projectDir,
        ".codex-worktrees",
        "1710000000-0001",
      ),
      branchName: "codex/slack/1710000000-0001",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
      ensureThreadWorktree,
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U123",
      reply: vi.fn(),
    });

    expect(ensureThreadWorktree).toHaveBeenCalledWith({
      repoPath: fixture.projectDir,
      slackThreadTs: "1710000000.0001",
      baseBranch: "develop",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "develop",
    });
  });

  it("persists a failed_setup thread mapping when the initial turn start fails", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    const turnStart = vi.fn().mockRejectedValue(new Error("turn failed"));
    const ensureThreadWorktree = vi.fn().mockResolvedValue({
      worktreePath: join(
        fixture.projectDir,
        ".codex-worktrees",
        "1710000000-0001",
      ),
      branchName: "codex/slack/1710000000-0001",
    });
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
      ensureThreadWorktree,
    });

    await expect(
      service.handleSlackMessage({
        channelId: "C08TEMPLATE",
        messageTs: "1710000000.0001",
        threadTs: "1710000000.0001",
        text: "Investigate the failing tests",
        userId: "U123",
        reply: vi.fn(),
      }),
    ).rejects.toThrow("turn failed");

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      activeTurnId: null,
      state: "failed_setup",
      worktreePath: join(
        fixture.projectDir,
        ".codex-worktrees",
        "1710000000-0001",
      ),
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });
  });
});
