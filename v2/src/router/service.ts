import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import type { ThreadRecord, ThreadWorktree } from "../domain/types.js";
import { buildMergeConfirmation, type MergeConfirmationBlock } from "../git/merge_to_main.js";
import type { RepositoryStatus } from "../git/repository_status.js";
import { RouterStore } from "../persistence/store.js";
import {
  renderContinuedTask,
  renderEmptyMessage,
  renderMissingSession,
  renderRunningTurn,
  renderStartedTask,
  renderUnauthorizedUser,
  renderUnknownChannel,
} from "../slack/render.js";

type ReplyFn = (message: string) => void | Promise<void>;

type SlackMessageInput = {
  channelId: string;
  messageTs: string;
  threadTs: string;
  text: string;
  userId: string;
  reply: ReplyFn;
};

type ThreadStartFn = (input: { cwd: string }) => Promise<{ threadId: string }>;
type TurnStartFn = (input: {
  cwd: string;
  prompt: string;
  threadId: string;
}) => Promise<Record<string, unknown>>;
type TurnInterruptFn = (input: {
  threadId: string;
  turnId: string;
}) => Promise<void>;
type ReviewStartFn = (input: {
  threadId: string;
  target: { type: "uncommittedChanges" };
}) => Promise<Record<string, unknown>>;
type EnsureThreadWorktreeFn = (input: {
  repoPath: string;
  slackThreadTs: string;
  baseBranch: string;
}) => Promise<Pick<ThreadWorktree, "worktreePath" | "branchName">>;

type ProjectConfig = {
  channelId: string;
  name: string;
  path: string;
  baseBranch: string;
};

type RouterServiceOptions = {
  allowedUserId: string;
  projectsFile: string;
  store: RouterStore;
  threadStart: ThreadStartFn;
  turnStart: TurnStartFn;
  turnInterrupt?: TurnInterruptFn;
  reviewStart?: ReviewStartFn;
  ensureThreadWorktree?: EnsureThreadWorktreeFn;
  requestRestart?: (input: {
    slackChannelId: string;
    slackThreadTs: string;
  }) => Promise<{ exitCode: number }>;
  getRepositoryStatus?: (input: {
    repoPath: string;
    sourceBranch: string;
    targetBranch: string;
  }) => Promise<RepositoryStatus>;
  executeMergeToMain?: (input: {
    repoPath: string;
    sourceBranch: string;
    targetBranch: string;
  }) => Promise<{ text: string }>;
};

type ProjectRegistryDocument = {
  projects?: Array<{
    channel_id?: string;
    name?: string;
    path?: string;
    base_branch?: string;
  }>;
};

type MergeSelection = {
  promptId?: number;
  sourceBranch: string;
  targetBranch: string;
};

export class RouterService {
  private readonly projects: Map<string, ProjectConfig>;
  private readonly threadCreationLocks = new Map<
    string,
    { active: boolean; queue: Array<() => void> }
  >();

  constructor(private readonly options: RouterServiceOptions) {
    this.projects = loadProjects(options.projectsFile);
  }

  async handleSlackMessage(input: SlackMessageInput): Promise<void> {
    if (!this.isAuthorizedUser(input.userId)) {
      await input.reply(renderUnauthorizedUser());
      return;
    }

    const prompt = input.text.trim();
    if (!prompt) {
      await input.reply(renderEmptyMessage());
      return;
    }

    const project = this.projects.get(input.channelId);
    if (!project) {
      await input.reply(renderUnknownChannel());
      return;
    }

    const existingThread = this.options.store.getThread(input.channelId, input.threadTs);
    if (existingThread) {
      await this.withThreadCreationLock(input.channelId, input.threadTs, async () => {
        const lockedThread = this.options.store.getThread(input.channelId, input.threadTs);
        if (!lockedThread) {
          await this.handleExistingThread(input, project, existingThread, prompt);
          return;
        }

        await this.handleExistingThread(input, project, lockedThread, prompt);
      });
      return;
    }

    if (input.threadTs !== input.messageTs) {
      await input.reply(renderMissingSession());
      return;
    }

    await this.withThreadCreationLock(input.channelId, input.threadTs, async () => {
      const lockedThread = this.options.store.getThread(input.channelId, input.threadTs);
      if (lockedThread) {
        await this.handleExistingThread(input, project, lockedThread, prompt);
        return;
      }

      const worktree = await this.resolveThreadWorktree(
        project.path,
        input.threadTs,
        project.baseBranch,
      );

      const startedThread = await this.options.threadStart({
        cwd: worktree.worktreePath,
      });

      const baseThreadRecord = buildThreadRecord(
        input.channelId,
        input.threadTs,
        startedThread.threadId,
        worktree,
      );
      this.options.store.upsertThread(baseThreadRecord);
      let turn: Record<string, unknown>;

      try {
        turn = await this.options.turnStart({
          cwd: worktree.worktreePath,
          prompt,
          threadId: startedThread.threadId,
        });
      } catch (error) {
        this.updateThreadIfCurrent(
          input.channelId,
          input.threadTs,
          baseThreadRecord,
          {
            ...baseThreadRecord,
            state: "failed_setup",
          },
        );
        throw error;
      }

      const startedThreadRecord = {
        ...(this.options.store.getThread(input.channelId, input.threadTs) ?? baseThreadRecord),
        slackChannelId: input.channelId,
        slackThreadTs: input.threadTs,
        appServerThreadId: startedThread.threadId,
        activeTurnId: readTurnId(turn),
        appServerSessionStale: false,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        baseBranch: worktree.baseBranch,
      };
      if (
        this.updateThreadIfCurrent(
          input.channelId,
          input.threadTs,
          baseThreadRecord,
          startedThreadRecord,
        )
      ) {
        await input.reply(renderStartedTask(project.name));
      }
    });
  }

  async interruptThread(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
    expectedTurnId?: string,
  ): Promise<void> {
    this.requireAuthorizedUser(userId);
    const thread = this.requireThread(slackChannelId, slackThreadTs);
    this.requireLiveSession(thread);
    if (thread.state !== "running") {
      throw new Error("This Slack thread is not running an interruptible turn.");
    }
    if (!thread.activeTurnId) {
      throw new Error("No active turn recorded for this Slack thread.");
    }
    if (expectedTurnId && expectedTurnId !== thread.activeTurnId) {
      throw new Error("Interrupt control is stale. Request the latest update and try again.");
    }

    if (!this.options.turnInterrupt) {
      throw new Error("Interrupt control is not configured.");
    }

    await this.options.turnInterrupt({
      threadId: thread.appServerThreadId,
      turnId: thread.activeTurnId,
    });

    const latestThread = this.options.store.getThread(slackChannelId, slackThreadTs);
    if (
      !latestThread ||
      latestThread.appServerThreadId !== thread.appServerThreadId ||
      latestThread.state !== "running" ||
      latestThread.activeTurnId !== thread.activeTurnId
    ) {
      return;
    }

    this.options.store.upsertThread({
      ...latestThread,
      activeTurnId: null,
      state: "interrupted",
    });
    this.invalidateMergePreviews(slackChannelId, slackThreadTs);
  }

  async submitChoice(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
    choice: string,
    promptId?: number,
  ): Promise<void> {
    this.requireAuthorizedUser(userId);
    const prompt = choice.trim();
    if (!prompt) {
      throw new Error("Choice cannot be empty.");
    }

    const thread = this.requireThread(slackChannelId, slackThreadTs);
    this.requireLiveSession(thread);
    if (thread.state !== "awaiting_user_input") {
      throw new Error("This Slack thread is not waiting for a choice.");
    }

    const latestChoicePrompt = this.options.store.getLatestChoicePrompt(
      slackChannelId,
      slackThreadTs,
    );
    if (
      !latestChoicePrompt ||
      promptId !== latestChoicePrompt.promptId ||
      !latestChoicePrompt.options.includes(prompt)
    ) {
      throw new Error("Choice is no longer valid. Request the latest prompt and try again.");
    }

    const pendingThread = {
      ...thread,
      activeTurnId: null,
      appServerSessionStale: false,
      state: "running",
    } as ThreadRecord;
    this.options.store.upsertThread(pendingThread);

    let turn: Record<string, unknown>;
    try {
      turn = await this.options.turnStart({
        cwd: thread.worktreePath,
        prompt,
        threadId: thread.appServerThreadId,
      });
    } catch (error) {
      this.updateThreadIfCurrent(slackChannelId, slackThreadTs, pendingThread, thread);
      throw error;
    }

    const resumedThreadRecord = {
      ...pendingThread,
      slackChannelId,
      slackThreadTs,
      appServerThreadId: thread.appServerThreadId,
      activeTurnId: readTurnId(turn),
      appServerSessionStale: false,
      worktreePath: thread.worktreePath,
      branchName: thread.branchName,
      baseBranch: thread.baseBranch,
    };
    if (
      this.updateThreadIfCurrent(
        slackChannelId,
        slackThreadTs,
        pendingThread,
        resumedThreadRecord,
      )
    ) {
      this.options.store.resolveChoicePrompts(slackChannelId, slackThreadTs);
      this.invalidateMergePreviews(slackChannelId, slackThreadTs);
    }
  }

  async startReview(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
    expectedThreadId?: string,
  ): Promise<void> {
    this.requireAuthorizedUser(userId);
    const thread = this.requireThread(slackChannelId, slackThreadTs);
    this.requireLiveSession(thread);
    if (thread.state !== "idle") {
      throw new Error("This Slack thread is not ready for review.");
    }
    if (expectedThreadId && expectedThreadId !== thread.appServerThreadId) {
      throw new Error("Review control is stale. Request the latest update and try again.");
    }
    if (!this.options.reviewStart) {
      throw new Error("Review control is not configured.");
    }

    const review = await this.options.reviewStart({
      threadId: thread.appServerThreadId,
      target: { type: "uncommittedChanges" },
    });

    if (
      this.updateThreadIfCurrent(slackChannelId, slackThreadTs, thread, {
        ...thread,
        activeTurnId: readTurnId(review),
        appServerSessionStale: false,
        state: "running",
      })
    ) {
      this.invalidateMergePreviews(slackChannelId, slackThreadTs);
    }
  }

  getThreadStatus(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
  ): ThreadRecord | null {
    this.requireAuthorizedUser(userId);
    return this.options.store.getThread(slackChannelId, slackThreadTs);
  }

  async requestRestart(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
  ): Promise<{ exitCode: number }> {
    this.requireAuthorizedUser(userId);
    this.requireThread(slackChannelId, slackThreadTs);

    if (!this.options.requestRestart) {
      throw new Error("Restart control is not configured.");
    }

    const result = await this.options.requestRestart({
      slackChannelId,
      slackThreadTs,
    });
    this.invalidateMergePreviews(slackChannelId, slackThreadTs);
    return result;
  }

  async restartRouter(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
  ): Promise<{ exitCode: number; message: string }> {
    const result = await this.requestRestart(userId, slackChannelId, slackThreadTs);

    return {
      exitCode: result.exitCode,
      message: "Router restart requested.",
    };
  }

  async previewMergeToMain(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
    expectedThreadId?: string,
  ): Promise<{ text: string; blocks: MergeConfirmationBlock[] }> {
    this.requireAuthorizedUser(userId);
    const thread = this.requireThread(slackChannelId, slackThreadTs);
    this.requireLiveSession(thread);
    if (expectedThreadId && expectedThreadId !== thread.appServerThreadId) {
      throw new Error("Merge preview control is stale. Request a fresh merge preview.");
    }
    if (thread.state !== "idle") {
      throw new Error("This Slack thread is not ready to preview a merge.");
    }
    if (thread.branchName === thread.baseBranch) {
      throw new Error("This Slack thread is already on the base branch.");
    }

    if (!this.options.getRepositoryStatus) {
      throw new Error("Merge status is not configured.");
    }

    const status = await this.options.getRepositoryStatus({
      repoPath: thread.worktreePath,
      sourceBranch: thread.branchName,
      targetBranch: thread.baseBranch,
    });
    this.invalidateMergePreviews(slackChannelId, slackThreadTs);
    const promptId = this.options.store.recordMergePreview({
      slackChannelId,
      slackThreadTs,
      sourceBranch: status.sourceBranch,
      targetBranch: status.targetBranch,
    });
    if (!promptId) {
      throw new Error("Failed to persist merge preview.");
    }

    return {
      text: `Merge ${status.sourceBranch} into ${status.targetBranch}?`,
      blocks: buildMergeConfirmation({
        ...status,
        promptId,
      }),
    };
  }

  async mergeToMain(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
    expectedThreadId?: string,
  ): Promise<{ text: string; blocks: MergeConfirmationBlock[] }> {
    return this.previewMergeToMain(userId, slackChannelId, slackThreadTs, expectedThreadId);
  }

  async confirmMergeToMain(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
    expectedSelection?: MergeSelection,
  ): Promise<{ text: string }> {
    this.requireAuthorizedUser(userId);
    const thread = this.requireThread(slackChannelId, slackThreadTs);
    this.requireLiveSession(thread);
    if (thread.state !== "idle") {
      throw new Error("This Slack thread is not ready to confirm a merge.");
    }
    if (
      expectedSelection &&
      !this.matchesLatestMergePreview(
        slackChannelId,
        slackThreadTs,
        thread,
        expectedSelection,
      )
    ) {
      throw new Error("Merge confirmation is stale. Request a fresh merge preview.");
    }
    if (thread.branchName === thread.baseBranch) {
      throw new Error("This Slack thread is already on the base branch.");
    }
    if (!this.options.getRepositoryStatus) {
      throw new Error("Merge status is not configured.");
    }
    if (!this.options.executeMergeToMain) {
      throw new Error("Merge execution is not configured.");
    }

    const status = await this.options.getRepositoryStatus({
      repoPath: thread.worktreePath,
      sourceBranch: thread.branchName,
      targetBranch: thread.baseBranch,
    });

    if (status.worktreeStatus !== "clean") {
      throw new Error("This Slack thread has uncommitted changes and cannot be merged.");
    }

    const mergedRepoPath = deriveRepositoryPath(thread.worktreePath);
    if (mergedRepoPath !== thread.worktreePath) {
      const rootStatus = await this.options.getRepositoryStatus({
        repoPath: mergedRepoPath,
        sourceBranch: thread.branchName,
        targetBranch: thread.baseBranch,
      });

      if (rootStatus.worktreeStatus !== "clean") {
        throw new Error(
          "The repository root checkout has uncommitted changes and cannot be merged.",
        );
      }
    }

    const result = await this.options.executeMergeToMain({
      repoPath: mergedRepoPath,
      sourceBranch: thread.branchName,
      targetBranch: thread.baseBranch,
    });

    this.updateThreadIfCurrent(slackChannelId, slackThreadTs, thread, {
      ...thread,
      worktreePath: mergedRepoPath,
      branchName: thread.baseBranch,
      activeTurnId: null,
      appServerSessionStale: true,
      state: "idle",
    });
    this.invalidateMergePreviews(slackChannelId, slackThreadTs);

    return result;
  }

  private async resolveThreadWorktree(
    repoPath: string,
    slackThreadTs: string,
    baseBranch: string,
  ): Promise<ThreadWorktree> {
    const worktree =
      (await this.options.ensureThreadWorktree?.({
        repoPath,
        slackThreadTs,
        baseBranch,
      })) ?? {
        worktreePath: repoPath,
        branchName: baseBranch,
      };

    return {
      ...worktree,
      baseBranch,
    };
  }

  private async handleExistingThread(
    input: SlackMessageInput,
    project: ProjectConfig,
    existingThread: ThreadRecord,
    prompt: string,
  ): Promise<void> {
    if (existingThread.appServerSessionStale) {
      const reboundWorktree = existsSync(existingThread.worktreePath)
        ? {
            worktreePath: existingThread.worktreePath,
            branchName: existingThread.branchName,
            baseBranch: existingThread.baseBranch,
          }
        : await this.resolveThreadWorktree(
            project.path,
            input.threadTs,
            existingThread.baseBranch,
          );
      const reboundThread = await this.options.threadStart({
        cwd: reboundWorktree.worktreePath,
      });
      const reboundRecord = {
        ...existingThread,
        ...reboundWorktree,
        appServerThreadId: reboundThread.threadId,
        activeTurnId: null,
        appServerSessionStale: false,
        state: "running" as const,
      };
      this.options.store.upsertThread(reboundRecord);

      let turn: Record<string, unknown>;
      try {
        turn = await this.options.turnStart({
          cwd: reboundWorktree.worktreePath,
          prompt,
          threadId: reboundThread.threadId,
        });
      } catch (error) {
        this.updateThreadIfCurrent(input.channelId, input.threadTs, reboundRecord, existingThread);
        throw error;
      }

      const continuedThreadRecord = {
        ...reboundRecord,
        slackChannelId: input.channelId,
        slackThreadTs: input.threadTs,
        appServerThreadId: reboundThread.threadId,
        activeTurnId: readTurnId(turn),
        appServerSessionStale: false,
        worktreePath: reboundWorktree.worktreePath,
        branchName: reboundWorktree.branchName,
        baseBranch: reboundWorktree.baseBranch,
      };
      if (
        this.updateThreadIfCurrent(
          input.channelId,
          input.threadTs,
          reboundRecord,
          continuedThreadRecord,
        )
      ) {
        this.invalidateMergePreviews(input.channelId, input.threadTs);
        await input.reply(renderContinuedTask(project.name));
      }
      return;
    }

    if (existingThread.state === "failed_setup") {
      const restartedWorktree = existsSync(existingThread.worktreePath)
        ? {
            worktreePath: existingThread.worktreePath,
            branchName: existingThread.branchName,
            baseBranch: existingThread.baseBranch,
          }
        : await this.resolveThreadWorktree(
            project.path,
            input.threadTs,
            existingThread.baseBranch,
          );
      const restartedThread = await this.options.threadStart({
        cwd: restartedWorktree.worktreePath,
      });
      const restartedRecord = {
        ...existingThread,
        ...restartedWorktree,
        appServerThreadId: restartedThread.threadId,
        activeTurnId: null,
        appServerSessionStale: false,
        state: "running" as const,
      };
      this.options.store.upsertThread(restartedRecord);

      let turn: Record<string, unknown>;
      try {
        turn = await this.options.turnStart({
          cwd: restartedWorktree.worktreePath,
          prompt,
          threadId: restartedThread.threadId,
        });
      } catch (error) {
        this.updateThreadIfCurrent(input.channelId, input.threadTs, restartedRecord, existingThread);
        throw error;
      }

      const continuedThreadRecord = {
        ...restartedRecord,
        slackChannelId: input.channelId,
        slackThreadTs: input.threadTs,
        appServerThreadId: restartedThread.threadId,
        activeTurnId: readTurnId(turn),
        appServerSessionStale: false,
        worktreePath: restartedWorktree.worktreePath,
        branchName: restartedWorktree.branchName,
        baseBranch: restartedWorktree.baseBranch,
      };
      if (
        this.updateThreadIfCurrent(
          input.channelId,
          input.threadTs,
          restartedRecord,
          continuedThreadRecord,
        )
      ) {
        this.invalidateMergePreviews(input.channelId, input.threadTs);
        await input.reply(renderContinuedTask(project.name));
      }
      return;
    }

    if (existingThread.state === "running") {
      await input.reply(renderRunningTurn());
      return;
    }

    const provisionalThread = {
      ...existingThread,
      activeTurnId: null,
      appServerSessionStale: false,
      state: "running" as const,
    };
    this.options.store.upsertThread(provisionalThread);

    let turn: Record<string, unknown>;
    try {
      turn = await this.options.turnStart({
        cwd: existingThread.worktreePath,
        prompt,
        threadId: existingThread.appServerThreadId,
      });
    } catch (error) {
      this.updateThreadIfCurrent(input.channelId, input.threadTs, provisionalThread, existingThread);
      throw error;
    }

    const continuedThreadRecord = {
      ...provisionalThread,
      slackChannelId: input.channelId,
      slackThreadTs: input.threadTs,
      appServerThreadId: existingThread.appServerThreadId,
      activeTurnId: readTurnId(turn),
      appServerSessionStale: false,
      worktreePath: provisionalThread.worktreePath,
      branchName: provisionalThread.branchName,
      baseBranch: provisionalThread.baseBranch,
    };
    if (
      this.updateThreadIfCurrent(
        input.channelId,
        input.threadTs,
        provisionalThread,
        continuedThreadRecord,
      )
    ) {
      this.invalidateMergePreviews(input.channelId, input.threadTs);
      await input.reply(renderContinuedTask(project.name));
    }
  }

  private async withThreadCreationLock<T>(
    slackChannelId: string,
    slackThreadTs: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${slackChannelId}\u0000${slackThreadTs}`;
    let state = this.threadCreationLocks.get(lockKey);
    if (!state) {
      state = { active: false, queue: [] };
      this.threadCreationLocks.set(lockKey, state);
    }

    if (state.active) {
      await new Promise<void>((resolve) => {
        state.queue.push(resolve);
      });
    }

    state.active = true;

    try {
      return await task();
    } finally {
      const next = state.queue.shift();
      if (next) {
        next();
      } else {
        state.active = false;
        this.threadCreationLocks.delete(lockKey);
      }
    }
  }

  private requireThread(
    slackChannelId: string,
    slackThreadTs: string,
  ): ThreadRecord {
    const thread = this.options.store.getThread(slackChannelId, slackThreadTs);
    if (!thread) {
      throw new Error("This thread has no stored Codex session yet.");
    }

    return thread;
  }

  private requireAuthorizedUser(userId: string): void {
    if (!this.isAuthorizedUser(userId)) {
      throw new Error(renderUnauthorizedUser());
    }
  }

  private requireLiveSession(thread: ThreadRecord): void {
    if (thread.appServerSessionStale) {
      throw new Error("This Slack thread needs a new message to refresh the Codex session.");
    }
  }

  private isAuthorizedUser(userId: string): boolean {
    return userId === this.options.allowedUserId;
  }

  private invalidateMergePreviews(slackChannelId: string, slackThreadTs: string): void {
    this.options.store.resolveMergePreviews(slackChannelId, slackThreadTs);
  }

  private updateThreadIfCurrent(
    slackChannelId: string,
    slackThreadTs: string,
    expectedThread: ThreadRecord,
    nextThread: ThreadRecord,
  ): boolean {
    const latestThread = this.options.store.getThread(slackChannelId, slackThreadTs);
    if (!latestThread || !sameThreadSnapshot(latestThread, expectedThread)) {
      return false;
    }

    this.options.store.upsertThread(nextThread);
    return true;
  }

  private matchesLatestMergePreview(
    slackChannelId: string,
    slackThreadTs: string,
    thread: ThreadRecord,
    expectedSelection: MergeSelection,
  ): boolean {
    if (!expectedSelection.promptId) {
      return false;
    }

    const latestMergePreview = this.options.store.getLatestMergePreview(
      slackChannelId,
      slackThreadTs,
    );
    if (!latestMergePreview) {
      return false;
    }

    return (
      latestMergePreview.promptId === expectedSelection.promptId &&
      latestMergePreview.sourceBranch === expectedSelection.sourceBranch &&
      latestMergePreview.targetBranch === expectedSelection.targetBranch &&
      latestMergePreview.sourceBranch === thread.branchName &&
      latestMergePreview.targetBranch === thread.baseBranch
    );
  }
}

function buildThreadRecord(
  slackChannelId: string,
  slackThreadTs: string,
  appServerThreadId: string,
  worktree: ThreadWorktree,
): ThreadRecord {
  return {
    slackChannelId,
    slackThreadTs,
    appServerThreadId,
    activeTurnId: null,
    appServerSessionStale: false,
    state: "running",
    ...worktree,
  };
}

function readTurnId(result: Record<string, unknown>): string | null {
  if (typeof result.turnId === "string") {
    return result.turnId;
  }

  if (typeof result.reviewId === "string") {
    return result.reviewId;
  }

  const review = result.review;
  if (review && typeof review === "object" && !Array.isArray(review)) {
    return typeof (review as { id?: unknown }).id === "string"
      ? (review as { id: string }).id
      : null;
  }

  return null;
}

function deriveRepositoryPath(worktreePath: string): string {
  const markers = ["/.codex-worktrees/", "\\.codex-worktrees\\"];

  for (const marker of markers) {
    const markerIndex = worktreePath.lastIndexOf(marker);
    if (markerIndex >= 0) {
      return worktreePath.slice(0, markerIndex);
    }
  }

  return worktreePath;
}

function sameThreadSnapshot(current: ThreadRecord, expected: ThreadRecord): boolean {
  return (
    current.slackChannelId === expected.slackChannelId &&
    current.slackThreadTs === expected.slackThreadTs &&
    current.appServerThreadId === expected.appServerThreadId &&
    current.activeTurnId === expected.activeTurnId &&
    Boolean(current.appServerSessionStale) === Boolean(expected.appServerSessionStale) &&
    current.state === expected.state &&
    current.worktreePath === expected.worktreePath &&
    current.branchName === expected.branchName &&
    current.baseBranch === expected.baseBranch
  );
}

function loadProjects(projectsFile: string): Map<string, ProjectConfig> {
  const projectsPath = resolve(projectsFile);
  const document = YAML.parse(
    readFileSync(projectsPath, "utf8"),
  ) as ProjectRegistryDocument | null;
  const registryDir = dirname(projectsPath);
  const projects = new Map<string, ProjectConfig>();

  for (const project of document?.projects ?? []) {
    const channelId = project.channel_id?.trim();
    const name = project.name?.trim();
    const rawPath = project.path?.trim();
    const baseBranch = project.base_branch?.trim() || "main";

    if (!channelId || !name || !rawPath) {
      throw new Error("Malformed project entry in project registry");
    }

    if (projects.has(channelId)) {
      throw new Error(`Duplicate channel_id '${channelId}' in project registry`);
    }

    const projectPath = resolveProjectPath(registryDir, rawPath);
    validateProjectPath(channelId, projectPath);

    projects.set(channelId, {
      channelId,
      name,
      path: projectPath,
      baseBranch,
    });
  }

  return projects;
}

function resolveProjectPath(registryDir: string, projectPath: string): string {
  if (isAbsolute(projectPath)) {
    return projectPath;
  }

  return resolve(registryDir, projectPath);
}

function validateProjectPath(channelId: string, projectPath: string): void {
  if (!existsSync(projectPath)) {
    throw new Error(`Project path for channel '${channelId}' does not exist: ${projectPath}`);
  }

  if (!statSync(projectPath).isDirectory()) {
    throw new Error(
      `Project path for channel '${channelId}' is not a directory: ${projectPath}`,
    );
  }
}
