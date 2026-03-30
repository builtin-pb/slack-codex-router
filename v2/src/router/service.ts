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
  sourceBranch: string;
  targetBranch: string;
};

export class RouterService {
  private readonly projects: Map<string, ProjectConfig>;

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
      if (existingThread.state === "running") {
        await input.reply(renderRunningTurn());
        return;
      }

      const provisionalThread = {
        ...existingThread,
        activeTurnId: null,
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
        this.options.store.upsertThread(existingThread);
        throw error;
      }

      this.options.store.upsertThread({
        ...provisionalThread,
        activeTurnId: readTurnId(turn),
      });
      await input.reply(renderContinuedTask(project.name));
      return;
    }

    if (input.threadTs !== input.messageTs) {
      await input.reply(renderMissingSession());
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
      this.options.store.upsertThread({
        ...baseThreadRecord,
        state: "failed_setup",
      });
      throw error;
    }

    this.options.store.upsertThread({
      ...baseThreadRecord,
      activeTurnId: readTurnId(turn),
    });
    await input.reply(renderStartedTask(project.name));
  }

  async interruptThread(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
  ): Promise<void> {
    this.requireAuthorizedUser(userId);
    const thread = this.requireThread(slackChannelId, slackThreadTs);
    if (thread.state !== "running") {
      throw new Error("This Slack thread is not running an interruptible turn.");
    }
    if (!thread.activeTurnId) {
      throw new Error("No active turn recorded for this Slack thread.");
    }

    if (!this.options.turnInterrupt) {
      throw new Error("Interrupt control is not configured.");
    }

    await this.options.turnInterrupt({
      threadId: thread.appServerThreadId,
      turnId: thread.activeTurnId,
    });

    this.options.store.upsertThread({
      ...thread,
      activeTurnId: null,
      state: "interrupted",
    });
  }

  async submitChoice(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
    choice: string,
  ): Promise<void> {
    this.requireAuthorizedUser(userId);
    const prompt = choice.trim();
    if (!prompt) {
      throw new Error("Choice cannot be empty.");
    }

    const thread = this.requireThread(slackChannelId, slackThreadTs);
    if (thread.state !== "awaiting_user_input") {
      throw new Error("This Slack thread is not waiting for a choice.");
    }

    this.options.store.upsertThread({
      ...thread,
      activeTurnId: null,
      state: "running",
    });

    let turn: Record<string, unknown>;
    try {
      turn = await this.options.turnStart({
        cwd: thread.worktreePath,
        prompt,
        threadId: thread.appServerThreadId,
      });
    } catch (error) {
      this.options.store.upsertThread(thread);
      throw error;
    }

    this.options.store.upsertThread({
      ...thread,
      activeTurnId: readTurnId(turn),
      state: "running",
    });
  }

  async startReview(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
  ): Promise<void> {
    this.requireAuthorizedUser(userId);
    const thread = this.requireThread(slackChannelId, slackThreadTs);
    if (thread.state !== "idle") {
      throw new Error("This Slack thread is not ready for review.");
    }
    if (!this.options.reviewStart) {
      throw new Error("Review control is not configured.");
    }

    const review = await this.options.reviewStart({
      threadId: thread.appServerThreadId,
      target: { type: "uncommittedChanges" },
    });

    this.options.store.upsertThread({
      ...thread,
      activeTurnId: readTurnId(review),
      state: "running",
    });
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

    return this.options.requestRestart({
      slackChannelId,
      slackThreadTs,
    });
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
  ): Promise<{ text: string; blocks: MergeConfirmationBlock[] }> {
    this.requireAuthorizedUser(userId);
    const thread = this.requireThread(slackChannelId, slackThreadTs);
    if (thread.state !== "idle") {
      throw new Error("This Slack thread is not ready to preview a merge.");
    }

    if (!this.options.getRepositoryStatus) {
      throw new Error("Merge status is not configured.");
    }

    const status = await this.options.getRepositoryStatus({
      repoPath: thread.worktreePath,
      sourceBranch: thread.branchName,
      targetBranch: thread.baseBranch,
    });

    return {
      text: `Merge ${status.sourceBranch} into ${status.targetBranch}?`,
      blocks: buildMergeConfirmation(status),
    };
  }

  async mergeToMain(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
  ): Promise<{ text: string; blocks: MergeConfirmationBlock[] }> {
    return this.previewMergeToMain(userId, slackChannelId, slackThreadTs);
  }

  async confirmMergeToMain(
    userId: string,
    slackChannelId: string,
    slackThreadTs: string,
    expectedSelection?: MergeSelection,
  ): Promise<{ text: string }> {
    this.requireAuthorizedUser(userId);
    const thread = this.requireThread(slackChannelId, slackThreadTs);
    if (thread.state !== "idle") {
      throw new Error("This Slack thread is not ready to confirm a merge.");
    }
    if (
      expectedSelection &&
      (expectedSelection.sourceBranch !== thread.branchName ||
        expectedSelection.targetBranch !== thread.baseBranch)
    ) {
      throw new Error("Merge confirmation is stale. Request a fresh merge preview.");
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

    this.options.store.upsertThread({
      ...thread,
      worktreePath: mergedRepoPath,
      branchName: thread.baseBranch,
      activeTurnId: null,
      state: "idle",
    });

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

  private isAuthorizedUser(userId: string): boolean {
    return userId === this.options.allowedUserId;
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
    state: "running",
    ...worktree,
  };
}

function readTurnId(result: Record<string, unknown>): string | null {
  return typeof result.turnId === "string" ? result.turnId : null;
}

function deriveRepositoryPath(worktreePath: string): string {
  const markers = ["/.codex-worktrees/", "\\.codex-worktrees\\"];

  for (const marker of markers) {
    const markerIndex = worktreePath.indexOf(marker);
    if (markerIndex >= 0) {
      return worktreePath.slice(0, markerIndex);
    }
  }

  return worktreePath;
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
