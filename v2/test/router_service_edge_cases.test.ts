import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";
import { createTempProjectFixture } from "./helpers/temp_project.js";

describe("RouterService edge cases", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("restores a stale thread record if the rebound turn fails", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_new" });
    const turnStart = vi.fn().mockRejectedValue(new Error("turn failed"));

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_old",
      activeTurnId: null,
      appServerSessionStale: true,
      state: "interrupted",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
    });

    await expect(
      service.handleSlackMessage({
        channelId: "C08TEMPLATE",
        messageTs: "1710000000.0002",
        threadTs: "1710000000.0001",
        text: "continue",
        userId: "U123",
        reply: vi.fn(),
      }),
    ).rejects.toThrow("turn failed");

    expect(threadStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
    });
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "continue",
      threadId: "thread_new",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toEqual({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_old",
      activeTurnId: null,
      appServerSessionStale: true,
      state: "interrupted",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
  });

  it("restores an idle thread record if a resumed turn fails", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnStart = vi.fn().mockRejectedValue(new Error("turn failed"));

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_old",
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

    await expect(
      service.handleSlackMessage({
        channelId: "C08TEMPLATE",
        messageTs: "1710000000.0002",
        threadTs: "1710000000.0001",
        text: "continue",
        userId: "U123",
        reply: vi.fn(),
      }),
    ).rejects.toThrow("turn failed");

    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "continue",
      threadId: "thread_existing",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toEqual({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_old",
      appServerSessionStale: false,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
  });

  it("rejects restart requests when no thread is stored yet", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const requestRestart = vi.fn();

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      requestRestart,
    });

    await expect(
      service.requestRestart("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This thread has no stored Codex session yet.");

    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("rejects restart requests when restart support is not configured", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
    });

    await expect(
      service.requestRestart("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("Restart control is not configured.");

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toEqual({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      appServerSessionStale: false,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
  });

  it("rejects blank choices before mutating the thread state", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_old",
      state: "awaiting_user_input",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
    });

    await expect(
      service.submitChoice("U123", "C08TEMPLATE", "1710000000.0001", "   "),
    ).rejects.toThrow("Choice cannot be empty.");

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toEqual({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_old",
      appServerSessionStale: false,
      state: "awaiting_user_input",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
  });

  it("rejects interrupts when the interrupt control is not configured", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_active",
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
    });

    await expect(
      service.interruptThread("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("Interrupt control is not configured.");

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toEqual({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_active",
      appServerSessionStale: false,
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
  });

  it("rejects review starts when the review control is not configured", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
    });

    await expect(
      service.startReview("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("Review control is not configured.");

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toEqual({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      appServerSessionStale: false,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
  });

  it("rejects merge preview when merge status support is missing", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
    });

    await expect(
      service.previewMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("Merge status is not configured.");
  });

  it("rejects merge confirmation when merge execution support is missing", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const getRepositoryStatus = vi.fn().mockResolvedValue({
      repositoryName: "template",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      worktreeStatus: "clean",
      checksStatus: "not run",
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
    });

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("Merge execution is not configured.");

    expect(getRepositoryStatus).not.toHaveBeenCalled();
  });
});
