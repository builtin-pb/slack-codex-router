import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";

function createProjectRegistryFixture(): { cleanup(): void; projectDir: string; projectsFile: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-"));
  const projectDir = join(tempDir, "project");
  const projectsFile = join(tempDir, "projects.yaml");

  mkdirSync(projectDir, { recursive: true });
  writeFileSync(projectsFile, `projects:\n  - channel_id: C08TEMPLATE\n    name: template\n    path: ${JSON.stringify(projectDir)}\n`, "utf8");

  return {
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    projectDir,
    projectsFile,
  };
}

function createRawProjectRegistryFixture(contents: string): {
  cleanup(): void;
  projectsFile: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-raw-"));
  const projectsFile = join(tempDir, "projects.yaml");

  writeFileSync(projectsFile, contents, "utf8");

  return {
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    projectsFile,
  };
}

function extractMergeSelection(
  blocks: Array<{ type?: string; elements?: Array<{ action_id?: string; value?: string }> }>,
): { promptId: number; sourceBranch: string; targetBranch: string } {
  const actionBlock = blocks.find((block) => block.type === "actions");
  const button = actionBlock?.elements?.find(
    (element) => element.action_id === "confirm_merge_to_main",
  );
  const value = button?.value ?? "";
  const firstSeparator = value.indexOf(":");
  const lastSeparator = value.lastIndexOf(":");
  const promptId = Number.parseInt(value.slice(0, firstSeparator), 10);

  if (
    !Number.isInteger(promptId) ||
    promptId <= 0 ||
    firstSeparator <= 0 ||
    lastSeparator <= firstSeparator ||
    lastSeparator >= value.length - 1
  ) {
    throw new Error(`Invalid merge confirmation payload: ${value}`);
  }

  return {
    promptId,
    sourceBranch: value.slice(firstSeparator + 1, lastSeparator),
    targetBranch: value.slice(lastSeparator + 1),
  };
}

describe("RouterService", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("starts a new App Server thread for a top-level Slack message and persists the mapping", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_abc" });
    const replies: string[] = [];

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
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

    expect(threadStart).toHaveBeenCalledTimes(1);
    expect(threadStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
    });
    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "Investigate the failing tests",
      threadId: "thread_abc",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      activeTurnId: "turn_abc",
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
    expect(replies).toEqual(["Started Codex task for project `template`."]);
  });

  it("persists the initial thread mapping before the first turn resolves", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    let resolveTurnStart: ((value: Record<string, unknown>) => void) | undefined;
    const turnStart = vi.fn().mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveTurnStart = resolve;
        }),
    );

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
    });

    const handleMessage = service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U123",
      reply: vi.fn(),
    });

    for (let attempt = 0; attempt < 5 && turnStart.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }

    expect(turnStart).toHaveBeenCalledTimes(1);

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      activeTurnId: null,
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    resolveTurnStart?.({ turnId: "turn_abc" });
    await handleMessage;

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      activeTurnId: "turn_abc",
      state: "running",
    });
  });

  it("resumes a stored App Server thread for Slack replies in an existing thread", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn();
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_resume" });
    const replies: string[] = [];

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
      threadStart,
      turnStart,
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

    expect(threadStart).not.toHaveBeenCalled();
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "Use the narrower repro",
      threadId: "thread_existing",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")?.state).toBe("running");
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")?.activeTurnId).toBe(
      "turn_resume",
    );
    expect(replies).toEqual(["Continuing Codex task for project `template`."]);
  });

  it("starts a fresh App Server thread when a recovered thread is marked with a stale session", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_fresh" });
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_fresh" });
    const replies: string[] = [];

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_stale",
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

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0002",
      threadTs: "1710000000.0001",
      text: "Resume after restart",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
    });
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "Resume after restart",
      threadId: "thread_fresh",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_fresh",
      activeTurnId: "turn_fresh",
      appServerSessionStale: false,
      state: "running",
    });
    expect(replies).toEqual(["Continuing Codex task for project `template`."]);
  });

  it("marks an existing thread as running before a resumed turn resolves", async () => {
    const fixture = createProjectRegistryFixture();
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

    const handleMessage = service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0002",
      threadTs: "1710000000.0001",
      text: "Use the narrower repro",
      userId: "U123",
      reply: vi.fn(),
    });

    for (let attempt = 0; attempt < 5 && turnStart.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }

    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    resolveTurnStart?.({ turnId: "turn_resume" });
    await handleMessage;

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      activeTurnId: "turn_resume",
      state: "running",
    });
  });

  it("rejects follow-up Slack messages while a turn is already running", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnStart = vi.fn();
    const replies: string[] = [];
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

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

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0002",
      threadTs: "1710000000.0001",
      text: "Another update",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(turnStart).not.toHaveBeenCalled();
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      activeTurnId: "turn_active",
      state: "running",
    });
    expect(replies).toEqual(["This Slack thread already has a running Codex turn."]);
  });

  it("interrupts the active turn using the stored thread and turn ids", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnInterrupt = vi.fn().mockResolvedValue(undefined);
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
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await service.interruptThread("U123", "C08TEMPLATE", "1710000000.0001");

    expect(turnInterrupt).toHaveBeenCalledWith({
      threadId: "thread_existing",
      turnId: "turn_active",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      state: "interrupted",
      activeTurnId: null,
    });
  });

  it("fails predictably when interrupting a thread without an active turn id", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnInterrupt = vi.fn();
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
      activeTurnId: null,
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await expect(
      service.interruptThread("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("No active turn recorded for this Slack thread.");
    expect(turnInterrupt).not.toHaveBeenCalled();
  });

  it("submits a choice as a new turn in the existing thread and persists the new active turn id", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_choice" });
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

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
    const promptId = store.recordChoicePrompt({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      options: ["approve", "reject"],
    });

    await service.submitChoice(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
      "approve",
      promptId ?? undefined,
    );

    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "approve",
      threadId: "thread_existing",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      state: "running",
      activeTurnId: "turn_choice",
    });
  });

  it("restores the previous thread state when choice submission fails", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnStart = vi.fn().mockRejectedValue(new Error("turn failed"));
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

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
    const promptId = store.recordChoicePrompt({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      options: ["approve", "reject"],
    });

    await expect(
      service.submitChoice(
        "U123",
        "C08TEMPLATE",
        "1710000000.0001",
        "approve",
        promptId ?? undefined,
      ),
    ).rejects.toThrow("turn failed");

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

  it("rejects a choice that is not among the latest persisted prompt options", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnStart = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

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
    const promptId = store.recordChoicePrompt({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      options: ["approve", "reject"],
    });

    await expect(
      service.submitChoice(
        "U123",
        "C08TEMPLATE",
        "1710000000.0001",
        "ship it",
        promptId ?? undefined,
      ),
    ).rejects.toThrow("Choice is no longer valid. Request the latest prompt and try again.");

    expect(turnStart).not.toHaveBeenCalled();
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

  it("rejects a stale choice click when a newer prompt reuses the same option label", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_choice" });
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

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
    const stalePromptId = store.recordChoicePrompt({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      options: ["approve", "reject"],
    });
    const latestPromptId = store.recordChoicePrompt({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      options: ["approve", "revise"],
    });

    await expect(
      service.submitChoice(
        "U123",
        "C08TEMPLATE",
        "1710000000.0001",
        "approve",
        stalePromptId ?? undefined,
      ),
    ).rejects.toThrow("Choice is no longer valid. Request the latest prompt and try again.");

    expect(turnStart).not.toHaveBeenCalled();
    expect(latestPromptId).toBeTypeOf("number");
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

  it("starts a review against uncommitted changes for the stored app server thread", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const reviewStart = vi.fn().mockResolvedValue({
      reviewId: "review_abc",
      turnId: "turn_review",
    });
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
      activeTurnId: "turn_old",
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await service.startReview("U123", "C08TEMPLATE", "1710000000.0001");

    expect(reviewStart).toHaveBeenCalledWith({
      threadId: "thread_existing",
      target: { type: "uncommittedChanges" },
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      activeTurnId: "turn_review",
      state: "running",
    });
  });

  it("treats a reviewId-only review response as the active id for the running review", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const reviewStart = vi.fn().mockResolvedValue({
      reviewId: "review_abc",
    });
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
      activeTurnId: "turn_old",
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await service.startReview("U123", "C08TEMPLATE", "1710000000.0001");

    expect(reviewStart).toHaveBeenCalledWith({
      threadId: "thread_existing",
      target: { type: "uncommittedChanges" },
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      activeTurnId: "review_abc",
      state: "running",
    });
  });

  it("rejects review when the thread is not idle", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const reviewStart = vi.fn();
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
      activeTurnId: "turn_old",
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await expect(
      service.startReview("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This Slack thread is not ready for review.");
    expect(reviewStart).not.toHaveBeenCalled();
  });

  it("returns stored thread metadata for Slack status replies", () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
    });

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

    expect(service.getThreadStatus("U123", "C08TEMPLATE", "1710000000.0001")).toEqual({
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

  it("records restart requests for an authorized stored thread", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const requestRestart = vi.fn().mockResolvedValue({ exitCode: 75 });
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      requestRestart,
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

    await expect(
      service.requestRestart("U123", "C08TEMPLATE", "1710000000.0001"),
    ).resolves.toEqual({ exitCode: 75 });
    expect(requestRestart).toHaveBeenCalledWith({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
    });
  });

  it("builds a merge preview from repository status for an idle thread", async () => {
    const fixture = createProjectRegistryFixture();
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
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
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

    const preview = await service.previewMergeToMain(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
    );

    expect(getRepositoryStatus).toHaveBeenCalledWith({
      repoPath: fixture.projectDir,
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
    });
    expect(preview.text).toContain("Merge codex/slack/1710000000-0001 into main?");
    expect(JSON.stringify(preview.blocks)).toContain("confirm_merge_to_main");
    expect(extractMergeSelection(preview.blocks as never)).toMatchObject({
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
    });
  });

  it("rejects merge preview when the thread is not idle", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const getRepositoryStatus = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_running",
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    await expect(
      service.previewMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This Slack thread is not ready to preview a merge.");
    expect(getRepositoryStatus).not.toHaveBeenCalled();
  });

  it("confirms merge to main for a clean idle thread and moves the thread back to the merged base branch", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadWorktreePath = join(
      fixture.projectDir,
      ".codex-worktrees",
      "1710000000-0001",
    );
    const getRepositoryStatus = vi.fn().mockResolvedValue({
      repositoryName: "template",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      worktreeStatus: "clean",
      checksStatus: "not run",
    });
    const executeMergeToMain = vi.fn().mockResolvedValue({
      text: "Merged codex/slack/1710000000-0001 into main.",
    });
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
      executeMergeToMain,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: threadWorktreePath,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).resolves.toEqual({
      text: "Merged codex/slack/1710000000-0001 into main.",
    });

    expect(executeMergeToMain).toHaveBeenCalledWith({
      repoPath: fixture.projectDir,
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
      state: "idle",
      activeTurnId: null,
    });
  });

  it("derives the repository root from the last .codex-worktrees segment in the path", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "router-service-nested-worktrees-"));
    const projectDir = join(tempDir, ".codex-worktrees", "project");
    const projectsFile = join(tempDir, "projects.yaml");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      projectsFile,
      `projects:\n  - channel_id: C08TEMPLATE\n    name: template\n    path: ${JSON.stringify(projectDir)}\n`,
      "utf8",
    );
    cleanups.push(() => rmSync(tempDir, { recursive: true, force: true }));

    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadWorktreePath = join(
      projectDir,
      ".codex-worktrees",
      "1710000000-0099",
    );
    const getRepositoryStatus = vi
      .fn()
      .mockResolvedValue({
        repositoryName: "template",
        sourceBranch: "codex/slack/1710000000-0099",
        targetBranch: "main",
        worktreeStatus: "clean",
        checksStatus: "not run",
      });
    const executeMergeToMain = vi.fn().mockResolvedValue({
      text: "Merged codex/slack/1710000000-0099 into main.",
    });
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
      executeMergeToMain,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0099",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: threadWorktreePath,
      branchName: "codex/slack/1710000000-0099",
      baseBranch: "main",
    });

    await service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0099");

    expect(getRepositoryStatus).toHaveBeenNthCalledWith(2, {
      repoPath: projectDir,
      sourceBranch: "codex/slack/1710000000-0099",
      targetBranch: "main",
    });
    expect(executeMergeToMain).toHaveBeenCalledWith({
      repoPath: projectDir,
      sourceBranch: "codex/slack/1710000000-0099",
      targetBranch: "main",
    });
  });

  it("rejects replayed merge confirmations after a successful merge updates the stored branch pair", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadWorktreePath = join(
      fixture.projectDir,
      ".codex-worktrees",
      "1710000000-0001",
    );
    const getRepositoryStatus = vi.fn().mockResolvedValue({
      repositoryName: "template",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      worktreeStatus: "clean",
      checksStatus: "not run",
    });
    const executeMergeToMain = vi.fn().mockResolvedValue({
      text: "Merged codex/slack/1710000000-0001 into main.",
    });
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
      executeMergeToMain,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: threadWorktreePath,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    const preview = await service.previewMergeToMain(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
    );
    const selection = extractMergeSelection(preview.blocks as never);

    await service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001", selection);

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001", selection),
    ).rejects.toThrow("This Slack thread needs a new message to refresh the Codex session.");

    expect(executeMergeToMain).toHaveBeenCalledTimes(1);
  });

  it("rejects merge preview when the thread is already on the base branch", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const getRepositoryStatus = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
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

    await expect(
      service.previewMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This Slack thread is already on the base branch.");

    expect(getRepositoryStatus).not.toHaveBeenCalled();
  });

  it("rejects merge preview for a stale idle session until the Slack thread refreshes", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const getRepositoryStatus = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      appServerSessionStale: true,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    await expect(
      service.previewMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This Slack thread needs a new message to refresh the Codex session.");

    expect(getRepositoryStatus).not.toHaveBeenCalled();
  });

  it("rejects merge confirmation for a stale idle session until the Slack thread refreshes", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const getRepositoryStatus = vi.fn();
    const executeMergeToMain = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
      executeMergeToMain,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      appServerSessionStale: true,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This Slack thread needs a new message to refresh the Codex session.");

    expect(getRepositoryStatus).not.toHaveBeenCalled();
    expect(executeMergeToMain).not.toHaveBeenCalled();
  });

  it("rejects merge confirmation when the worktree is dirty", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const getRepositoryStatus = vi.fn().mockResolvedValue({
      repositoryName: "template",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      worktreeStatus: "dirty",
      checksStatus: "not run",
    });
    const executeMergeToMain = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
      executeMergeToMain,
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

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This Slack thread has uncommitted changes and cannot be merged.");
    expect(executeMergeToMain).not.toHaveBeenCalled();
  });

  it("rejects merge confirmation when the repository root checkout is dirty", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadWorktreePath = join(
      fixture.projectDir,
      ".codex-worktrees",
      "1710000000-0001",
    );
    const getRepositoryStatus = vi
      .fn()
      .mockResolvedValueOnce({
        repositoryName: "template",
        sourceBranch: "codex/slack/1710000000-0001",
        targetBranch: "main",
        worktreeStatus: "clean",
        checksStatus: "not run",
      })
      .mockResolvedValueOnce({
        repositoryName: "template",
        sourceBranch: "codex/slack/1710000000-0001",
        targetBranch: "main",
        worktreeStatus: "dirty",
        checksStatus: "not run",
      });
    const executeMergeToMain = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
      executeMergeToMain,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: threadWorktreePath,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("The repository root checkout has uncommitted changes and cannot be merged.");

    expect(getRepositoryStatus).toHaveBeenNthCalledWith(1, {
      repoPath: threadWorktreePath,
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
    });
    expect(getRepositoryStatus).toHaveBeenNthCalledWith(2, {
      repoPath: fixture.projectDir,
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
    });
    expect(executeMergeToMain).not.toHaveBeenCalled();
  });

  it("rejects stale merge confirmations that no longer match the stored branch pair", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const getRepositoryStatus = vi.fn();
    const executeMergeToMain = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      getRepositoryStatus,
      executeMergeToMain,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "codex/slack/1710000000-0002",
      baseBranch: "main",
    });

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001", {
        promptId: 99,
        sourceBranch: "codex/slack/1710000000-0001",
        targetBranch: "main",
      }),
    ).rejects.toThrow("Merge confirmation is stale. Request a fresh merge preview.");
    expect(getRepositoryStatus).not.toHaveBeenCalled();
    expect(executeMergeToMain).not.toHaveBeenCalled();
  });

  it("rejects an old merge confirmation after the thread leaves idle and returns on the same branch pair", async () => {
    const fixture = createProjectRegistryFixture();
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
    const reviewStart = vi.fn().mockResolvedValue({ reviewId: "review_abc" });
    const executeMergeToMain = vi.fn().mockResolvedValue({
      text: "Merged codex/slack/1710000000-0001 into main.",
    });
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      reviewStart,
      getRepositoryStatus,
      executeMergeToMain,
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

    const preview = await service.previewMergeToMain(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
    );
    const oldSelection = extractMergeSelection(preview.blocks as never);

    await service.startReview("U123", "C08TEMPLATE", "1710000000.0001");

    const runningRecord = store.getThread("C08TEMPLATE", "1710000000.0001");
    expect(runningRecord).toMatchObject({
      state: "running",
      activeTurnId: "review_abc",
    });

    store.upsertThread({
      ...runningRecord!,
      activeTurnId: null,
      state: "idle",
    });

    await expect(
      service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0001", oldSelection),
    ).rejects.toThrow("Merge confirmation is stale. Request a fresh merge preview.");

    expect(executeMergeToMain).not.toHaveBeenCalled();
  });

  it("rejects unauthorized users before touching the project registry or App Server", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn();
    const turnStart = vi.fn();
    const replies: string[] = [];

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U999",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).not.toHaveBeenCalled();
    expect(turnStart).not.toHaveBeenCalled();
    expect(replies).toEqual(["User is not allowed to control this router."]);
  });

  it("fails fast when the project registry contains malformed entries", () => {
    const fixture = createRawProjectRegistryFixture(
      "projects:\n  - channel_id: C08TEMPLATE\n    path: ./project\n",
    );
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());

    expect(
      () =>
        new RouterService({
          allowedUserId: "U123",
          projectsFile: fixture.projectsFile,
          store,
          threadStart: vi.fn(),
          turnStart: vi.fn(),
        }),
    ).toThrow("Malformed project entry in project registry");
  });

  it("rejects thread controls from unauthorized users", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnInterrupt: vi.fn(),
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: "turn_old",
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await expect(
      service.interruptThread("U999", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("User is not allowed to control this router.");
  });

  it("rejects replayed choices once the thread is no longer awaiting input", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart: vi.fn(),
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await expect(
      service.submitChoice("U123", "C08TEMPLATE", "1710000000.0001", "approve"),
    ).rejects.toThrow("This Slack thread is not waiting for a choice.");
  });

  it("rejects stale choice submissions until the Slack thread refreshes its Codex session", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnStart = vi.fn();
    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart: vi.fn(),
      turnStart,
    });

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      activeTurnId: null,
      appServerSessionStale: true,
      state: "awaiting_user_input",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await expect(
      service.submitChoice("U123", "C08TEMPLATE", "1710000000.0001", "approve"),
    ).rejects.toThrow("This Slack thread needs a new message to refresh the Codex session.");

    expect(turnStart).not.toHaveBeenCalled();
  });

  it("rejects interrupt when the thread is no longer running", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const turnInterrupt = vi.fn();
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
      activeTurnId: "turn_old",
      state: "awaiting_user_input",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await expect(
      service.interruptThread("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This Slack thread is not running an interruptible turn.");
    expect(turnInterrupt).not.toHaveBeenCalled();
  });

  it("rejects review requests for stale idle sessions until a new message rebinds the App Server thread", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const reviewStart = vi.fn();
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
      appServerSessionStale: true,
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await expect(
      service.startReview("U123", "C08TEMPLATE", "1710000000.0001"),
    ).rejects.toThrow("This Slack thread needs a new message to refresh the Codex session.");

    expect(reviewStart).not.toHaveBeenCalled();
  });
});
