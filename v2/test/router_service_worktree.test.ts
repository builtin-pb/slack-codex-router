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

  it("serializes concurrent first-message deliveries for the same new Slack thread", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const replies: string[] = [];
    const threadStartGate = createDeferred<{ threadId: string }>();
    const turnStartGate = createDeferred<Record<string, unknown>>();
    const threadStart = vi.fn().mockReturnValue(threadStartGate.promise);
    const turnStart = vi.fn().mockReturnValue(turnStartGate.promise);

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
      ensureThreadWorktree: vi.fn().mockResolvedValue({
        worktreePath: join(
          fixture.projectDir,
          ".codex-worktrees",
          "1710000000-0001",
        ),
        branchName: "codex/slack/1710000000-0001",
      }),
    });

    const firstDispatch = service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });
    const secondDispatch = service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    await waitForCalls(threadStart, 1);
    expect(turnStart).not.toHaveBeenCalled();

    threadStartGate.resolve({ threadId: "thread_abc" });
    await waitForCalls(turnStart, 1);

    turnStartGate.resolve({ turnId: "turn_abc" });
    await Promise.all([firstDispatch, secondDispatch]);

    expect(threadStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(replies).toEqual([
      "Started Codex task for project `template`.",
      "This Slack thread already has a running Codex turn.",
    ]);
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      activeTurnId: "turn_abc",
      state: "running",
      worktreePath: join(
        fixture.projectDir,
        ".codex-worktrees",
        "1710000000-0001",
      ),
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });
  });

  it("collapses a burst of duplicate first-message deliveries into one real task start", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const replies: string[] = [];
    const threadStartGate = createDeferred<{ threadId: string }>();
    const turnStartGate = createDeferred<Record<string, unknown>>();
    const threadStart = vi.fn().mockReturnValue(threadStartGate.promise);
    const turnStart = vi.fn().mockReturnValue(turnStartGate.promise);

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
      ensureThreadWorktree: vi.fn().mockResolvedValue({
        worktreePath: join(
          fixture.projectDir,
          ".codex-worktrees",
          "1710000000-0002",
        ),
        branchName: "codex/slack/1710000000-0002",
      }),
    });

    const dispatches = Array.from({ length: 5 }, () =>
      service.handleSlackMessage({
        channelId: "C08TEMPLATE",
        messageTs: "1710000000.0002",
        threadTs: "1710000000.0002",
        text: "Investigate the failing tests",
        userId: "U123",
        reply: (message) => {
          replies.push(message);
        },
      }),
    );

    await waitForCalls(threadStart, 1);
    expect(turnStart).not.toHaveBeenCalled();

    threadStartGate.resolve({ threadId: "thread_abc" });
    await waitForCalls(turnStart, 1);

    turnStartGate.resolve({ turnId: "turn_abc" });
    await Promise.all(dispatches);

    expect(threadStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(replies).toEqual([
      "Started Codex task for project `template`.",
      "This Slack thread already has a running Codex turn.",
      "This Slack thread already has a running Codex turn.",
      "This Slack thread already has a running Codex turn.",
      "This Slack thread already has a running Codex turn.",
    ]);
    expect(store.getThread("C08TEMPLATE", "1710000000.0002")).toMatchObject({
      appServerThreadId: "thread_abc",
      activeTurnId: "turn_abc",
      state: "running",
      worktreePath: join(
        fixture.projectDir,
        ".codex-worktrees",
        "1710000000-0002",
      ),
      branchName: "codex/slack/1710000000-0002",
      baseBranch: "main",
    });
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

  it("recreates a missing worktree before retrying a failed_setup thread", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const missingWorktreePath = join(
      fixture.projectDir,
      ".codex-worktrees",
      "1710000000-0004",
    );
    const recreatedWorktreePath = join(
      fixture.projectDir,
      ".codex-worktrees",
      "1710000000-0004-recreated",
    );
    const ensureThreadWorktree = vi.fn().mockResolvedValue({
      worktreePath: recreatedWorktreePath,
      branchName: "codex/slack/1710000000-0004-recreated",
    });
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_retry" });
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_retry" });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0004",
      appServerThreadId: "thread_old",
      activeTurnId: null,
      appServerSessionStale: false,
      state: "failed_setup",
      worktreePath: missingWorktreePath,
      branchName: "codex/slack/1710000000-0004",
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
      messageTs: "1710000000.0005",
      threadTs: "1710000000.0004",
      text: "continue",
      userId: "U123",
      reply: vi.fn(),
    });

    expect(ensureThreadWorktree).toHaveBeenCalledWith({
      repoPath: fixture.projectDir,
      slackThreadTs: "1710000000.0004",
      baseBranch: "main",
    });
    expect(threadStart).toHaveBeenCalledWith({
      cwd: recreatedWorktreePath,
    });
    expect(turnStart).toHaveBeenCalledWith({
      cwd: recreatedWorktreePath,
      prompt: "continue",
      threadId: "thread_retry",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0004")).toMatchObject({
      appServerThreadId: "thread_retry",
      activeTurnId: "turn_retry",
      appServerSessionStale: false,
      state: "running",
      worktreePath: recreatedWorktreePath,
      branchName: "codex/slack/1710000000-0004-recreated",
      baseBranch: "main",
    });
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

async function waitForCalls<T extends (...args: never[]) => unknown>(
  spy: ReturnType<typeof vi.fn<T>>,
  expectedCalls: number,
): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (spy.mock.calls.length === expectedCalls) {
      return;
    }

    if (spy.mock.calls.length > expectedCalls) {
      break;
    }

    await Promise.resolve();
  }

  expect(spy).toHaveBeenCalledTimes(expectedCalls);
}
