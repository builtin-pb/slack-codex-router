import type { AppServerNotification } from "../../src/app_server/events.js";
import type { ThreadRecord } from "../../src/domain/types.js";
import { RouterStore } from "../../src/persistence/store.js";
import { startRouterRuntime } from "../../src/router/runtime.js";
import { RouterService } from "../../src/router/service.js";
import { registerSlackMessageHandler } from "../../src/slack/app.js";
import { createFakeSlackApp } from "./fake_slack_app.js";
import { createTempProjectFixture } from "./temp_project.js";

type AppServerNotificationListener = (notification: AppServerNotification) => void;

function createFakeAppServerProcess() {
  const listeners = new Set<(line: string) => void>();
  const writtenLines: string[] = [];
  let resolveExit: ((value: number | null) => void) | null = null;
  const exitPromise = new Promise<number | null>((resolve) => {
    resolveExit = resolve;
  });

  return {
    writtenLines,
    writeLine(line: string): void {
      writtenLines.push(line);
    },
    onLine(listener: (line: string) => void): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    waitForExit(): Promise<number | null> {
      return exitPromise;
    },
    emitLine(line: string): void {
      for (const listener of listeners) {
        listener(line);
      }
    },
    close(exitCode = 0): void {
      resolveExit?.(exitCode);
      resolveExit = null;
    },
  };
}

function createFakeAppServerClient() {
  const listeners = new Set<AppServerNotificationListener>();
  const handledLines: string[] = [];
  const failedRequests: Error[] = [];

  return {
    events: {
      subscribe(listener: AppServerNotificationListener): () => void {
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
        };
      },
      emit(notification: AppServerNotification): void {
        for (const listener of listeners) {
          listener(notification);
        }
      },
    },
    handledLines,
    failedRequests,
    async initialize(): Promise<void> {
      return undefined;
    },
    handleLine(line: string): void {
      handledLines.push(line);
    },
    failPendingRequests(error: Error): void {
      failedRequests.push(error);
    },
    async threadStart(): Promise<Record<string, unknown>> {
      return { threadId: "thread_abc" };
    },
    async turnStart(): Promise<Record<string, unknown>> {
      return { turnId: "turn_abc" };
    },
  };
}

export async function createRuntimeHarness(options: {
  seedThread?: boolean;
} = {}) {
  const project = createTempProjectFixture();
  const slack = createFakeSlackApp();
  const store = new RouterStore(project.routerStateDb);
  const appServerProcess = createFakeAppServerProcess();
  const appServerClient = createFakeAppServerClient();
  const routerService = new RouterService({
    allowedUserId: project.config.allowedUserId,
    projectsFile: project.config.projectsFile,
    store,
    threadStart: async () => ({ threadId: "thread_abc" }),
    turnStart: async () => ({ turnId: "turn_abc" }),
  });

  await startRouterRuntime({
    config: project.config,
    store,
    appServerProcess,
    appServerClient,
    slackApp: slack.app,
    routerService,
    registerSlackMessageHandler: (app, router) => {
      registerSlackMessageHandler(
        app as Parameters<typeof registerSlackMessageHandler>[0],
        router as RouterService,
      );
    },
  });

  if (options.seedThread) {
    store.upsertThread(buildSeedThreadRecord(project.projectDir));
  }

  const actionResponses: Array<Record<string, unknown>> = [];

  return {
    project,
    slack,
    store,
    routerService,
    appServerProcess,
    appServerClient,
    emitNotification(notification: AppServerNotification): void {
      appServerClient.events.emit(notification);
    },
    sendAppServerLine(line: string): void {
      appServerProcess.emitLine(line);
    },
    async dispatchTopLevelMessage(input: {
      user: string;
      channel: string;
      ts: string;
      text: string;
    }): Promise<void> {
      await slack.dispatchMessage({
        user: input.user,
        channel: input.channel,
        ts: input.ts,
        text: input.text,
      });
    },
    actionResponses,
    async dispatchAction(actionId: string, body: Record<string, unknown>): Promise<void> {
      await slack.dispatchAction(actionId, body, {
        respond: async (message) => {
          actionResponses.push(message);
          return undefined;
        },
      });
    },
    getAction(actionId: string) {
      return slack.getAction(actionId);
    },
    cleanup() {
      appServerProcess.close();
      store.close();
      project.cleanup();
    },
  };
}

function buildSeedThreadRecord(projectDir: string): ThreadRecord {
  return {
    slackChannelId: "C08TEMPLATE",
    slackThreadTs: "1710000000.0001",
    appServerThreadId: "thread_abc",
    activeTurnId: null,
    appServerSessionStale: false,
    state: "idle",
    worktreePath: projectDir,
    branchName: "main",
    baseBranch: "main",
  };
}
