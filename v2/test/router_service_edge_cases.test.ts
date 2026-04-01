import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
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

  it("recreates a missing worktree before rebinding a stale session", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const missingWorktreePath = join(fixture.projectDir, ".codex-worktrees", "1710000000-0003");
    const recreatedWorktreePath = join(
      fixture.projectDir,
      ".codex-worktrees",
      "1710000000-0003-recreated",
    );
    const ensureThreadWorktree = vi.fn().mockImplementation(async () => {
      mkdirSync(recreatedWorktreePath, { recursive: true });
      return {
        worktreePath: recreatedWorktreePath,
        branchName: "codex/slack/1710000000-0003-recreated",
      };
    });
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_new" });
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_new" });

    mkdirSync(missingWorktreePath, { recursive: true });
    rmSync(missingWorktreePath, { recursive: true, force: true });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0003",
      appServerThreadId: "thread_old",
      activeTurnId: null,
      appServerSessionStale: true,
      state: "interrupted",
      worktreePath: missingWorktreePath,
      branchName: "codex/slack/1710000000-0003",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      ensureThreadWorktree,
      threadStart,
      turnStart,
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0004",
      threadTs: "1710000000.0003",
      text: "continue",
      userId: "U123",
      reply: vi.fn(),
    });

    expect(ensureThreadWorktree).toHaveBeenCalledWith({
      repoPath: fixture.projectDir,
      slackThreadTs: "1710000000.0003",
      baseBranch: "main",
    });
    expect(threadStart).toHaveBeenCalledWith({
      cwd: recreatedWorktreePath,
    });
    expect(turnStart).toHaveBeenCalledWith({
      cwd: recreatedWorktreePath,
      prompt: "continue",
      threadId: "thread_new",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0003")).toMatchObject({
      appServerThreadId: "thread_new",
      activeTurnId: "turn_new",
      appServerSessionStale: false,
      state: "running",
      worktreePath: recreatedWorktreePath,
      branchName: "codex/slack/1710000000-0003-recreated",
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

  it("does not start a second turn when a typed reply arrives while a choice submission is already advancing", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    let resolveTurnStart: ((value: Record<string, unknown>) => void) | undefined;
    const turnStart = vi.fn().mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveTurnStart = resolve;
        }),
    );
    const replies: string[] = [];

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0002",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_old",
      state: "awaiting_user_input",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
    const promptId = store.recordChoicePrompt({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0002",
      options: ["approve", "reject"],
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

    const submitChoicePromise = service.submitChoice(
      "U123",
      "C08TEMPLATE",
      "1710000000.0002",
      "approve",
      promptId ?? undefined,
    );

    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "approve",
      threadId: "thread_existing",
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0003",
      threadTs: "1710000000.0002",
      text: "typed fallback",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(replies).toEqual(["This Slack thread already has a running Codex turn."]);
    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(store.getThread("C08TEMPLATE", "1710000000.0002")).toMatchObject({
      state: "running",
      activeTurnId: null,
    });

    resolveTurnStart?.({ turnId: "turn_choice" });
    await submitChoicePromise;

    expect(store.getThread("C08TEMPLATE", "1710000000.0002")).toMatchObject({
      state: "running",
      activeTurnId: "turn_choice",
    });
  });

  it("rejects a choice click when a typed reply is already advancing the same awaiting-user-input thread", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    let resolveTurnStart: ((value: Record<string, unknown>) => void) | undefined;
    const turnStart = vi.fn().mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveTurnStart = resolve;
        }),
    );
    const replies: string[] = [];

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0004",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_old",
      state: "awaiting_user_input",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
    const promptId = store.recordChoicePrompt({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0004",
      options: ["approve", "reject"],
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

    const handleMessagePromise = service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0005",
      threadTs: "1710000000.0004",
      text: "typed fallback",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    for (let attempt = 0; attempt < 5 && turnStart.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }

    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "typed fallback",
      threadId: "thread_existing",
    });

    await expect(
      service.submitChoice(
        "U123",
        "C08TEMPLATE",
        "1710000000.0004",
        "approve",
        promptId ?? undefined,
      ),
    ).rejects.toThrow("This Slack thread is not waiting for a choice.");

    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(store.getThread("C08TEMPLATE", "1710000000.0004")).toMatchObject({
      state: "running",
      activeTurnId: null,
    });

    resolveTurnStart?.({ turnId: "turn_reply" });
    await handleMessagePromise;

    expect(replies).toEqual(["Continuing Codex task for project `template`."]);
    expect(store.getThread("C08TEMPLATE", "1710000000.0004")).toMatchObject({
      state: "running",
      activeTurnId: "turn_reply",
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

  it("does not clobber a newer thread state when interrupt resolves after the thread changed", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());

    let resolveInterrupt: (() => void) | undefined;
    const turnInterrupt = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInterrupt = resolve;
        }),
    );
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnInterrupt,
    });

    store.upsertThread({
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

    const interruptPromise = service.interruptThread("U123", "C08TEMPLATE", "1710000000.0001");
    await Promise.resolve();

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_followup",
      appServerSessionStale: false,
      state: "awaiting_user_input",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    resolveInterrupt?.();
    await interruptPromise;

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toEqual({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_followup",
      appServerSessionStale: false,
      state: "awaiting_user_input",
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

  it("does not clobber a newer thread state when review startup resolves after the thread changed", async () => {
    const fixture = createTempProjectFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());

    let resolveReview: ((value: { reviewId: string }) => void) | undefined;
    const reviewStart = vi.fn().mockImplementation(
      () =>
        new Promise<{ reviewId: string }>((resolve) => {
          resolveReview = resolve;
        }),
    );
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      reviewStart,
    });

    store.upsertThread({
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

    const reviewPromise = service.startReview("U123", "C08TEMPLATE", "1710000000.0001");
    await Promise.resolve();

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_user_input",
      appServerSessionStale: false,
      state: "awaiting_user_input",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    resolveReview?.({ reviewId: "review_abc" });
    await reviewPromise;

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toEqual({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_user_input",
      appServerSessionStale: false,
      state: "awaiting_user_input",
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
