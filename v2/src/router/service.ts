import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import type { ThreadRecord } from "../domain/types.js";
import { RouterStore } from "../persistence/store.js";
import {
  renderContinuedTask,
  renderEmptyMessage,
  renderMissingSession,
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

type ProjectConfig = {
  channelId: string;
  name: string;
  path: string;
};

type RouterServiceOptions = {
  allowedUserId: string;
  projectsFile: string;
  store: RouterStore;
  threadStart: ThreadStartFn;
  turnStart: TurnStartFn;
};

type ProjectRegistryDocument = {
  projects?: Array<{
    channel_id?: string;
    name?: string;
    path?: string;
  }>;
};

export class RouterService {
  private readonly projects: Map<string, ProjectConfig>;

  constructor(private readonly options: RouterServiceOptions) {
    this.projects = loadProjects(options.projectsFile);
  }

  async handleSlackMessage(input: SlackMessageInput): Promise<void> {
    if (input.userId !== this.options.allowedUserId) {
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
      await this.options.turnStart({
        cwd: project.path,
        prompt,
        threadId: existingThread.appServerThreadId,
      });
      this.options.store.upsertThread({
        ...existingThread,
        state: "running",
        worktreePath: project.path,
      });
      await input.reply(renderContinuedTask(project.name));
      return;
    }

    if (input.threadTs !== input.messageTs) {
      await input.reply(renderMissingSession());
      return;
    }

    const startedThread = await this.options.threadStart({
      cwd: project.path,
    });

    this.options.store.upsertThread(
      buildThreadRecord(input.channelId, input.threadTs, startedThread.threadId, project.path),
    );

    await this.options.turnStart({
      cwd: project.path,
      prompt,
      threadId: startedThread.threadId,
    });
    await input.reply(renderStartedTask(project.name));
  }
}

function buildThreadRecord(
  slackChannelId: string,
  slackThreadTs: string,
  appServerThreadId: string,
  worktreePath: string,
): ThreadRecord {
  return {
    slackChannelId,
    slackThreadTs,
    appServerThreadId,
    state: "running",
    worktreePath,
    branchName: "main",
    baseBranch: "main",
  };
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
