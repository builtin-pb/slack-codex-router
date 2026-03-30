import { describe, expect, it, vi } from "vitest";
import { startRouterRuntime } from "../src/router/runtime.js";

function makeRuntimeHarness(overrides: {
  pendingRestartIntent?: {
    slackChannelId: string;
    slackThreadTs: string;
    requestedAt: string;
  } | null;
  recoverableThreads?: Array<{
    slackChannelId: string;
    slackThreadTs: string;
    appServerThreadId: string;
    state: "idle" | "running" | "awaiting_user_input" | "interrupted" | "failed_setup";
    worktreePath: string;
    branchName: string;
    baseBranch: string;
  }>;
  waitForExit?: () => Promise<number | null>;
} = {}) {
  const registerSlackMessageHandler = vi.fn();
  const initialize = vi.fn().mockResolvedValue(undefined);
  const handleLine = vi.fn();
  const failPendingRequests = vi.fn();
  const subscribe = vi.fn().mockReturnValue(() => {});
  const onLine = vi.fn().mockReturnValue(() => {});
  const waitForExit = vi
    .fn()
    .mockImplementation(overrides.waitForExit ?? (() => Promise.resolve(0)));
  const postMessage = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn().mockResolvedValue(undefined);
  const clearRestartIntent = vi.fn();
  const upsertThread = vi.fn();

  const store = {
    getPendingRestartIntent: vi
      .fn()
      .mockReturnValue(overrides.pendingRestartIntent ?? null),
    listRecoverableThreads: vi.fn().mockReturnValue(overrides.recoverableThreads ?? []),
    clearRestartIntent,
    upsertThread,
  };

  const appServerClient = {
    initialize,
    handleLine,
    failPendingRequests,
    events: {
      subscribe,
    },
    threadStart: vi.fn(),
    turnStart: vi.fn(),
  };

  const slackApp = {
    start,
    client: {
      chat: {
        postMessage,
      },
    },
    event: vi.fn(),
  };

  return {
    registerSlackMessageHandler,
    initialize,
    handleLine,
    failPendingRequests,
    subscribe,
    onLine,
    waitForExit,
    postMessage,
    start,
    clearRestartIntent,
    upsertThread,
    store,
    appServerClient,
    slackApp,
  };
}

describe("startRouterRuntime regressions", () => {
  it("does not post recovery or clear restart intent when no restart is pending", async () => {
    const harness = makeRuntimeHarness();

    await startRouterRuntime({
      config: {
        slackBotToken: "xoxb-test",
        slackAppToken: "xapp-test",
        allowedUserId: "U123",
        projectsFile: "/repo/config/projects.yaml",
        routerStateDb: "/repo/logs/router-v2.sqlite3",
        appServerCommand: ["codex", "app-server"],
      },
      store: harness.store,
      appServerProcess: {
        writeLine: vi.fn(),
        onLine: harness.onLine,
        waitForExit: harness.waitForExit,
      },
      appServerClient: harness.appServerClient,
      slackApp: harness.slackApp,
      routerService: {},
      registerSlackMessageHandler: harness.registerSlackMessageHandler,
    });

    expect(harness.postMessage).not.toHaveBeenCalled();
    expect(harness.clearRestartIntent).not.toHaveBeenCalled();
  });

  it("passes an Error to failPendingRequests when the App Server wait rejects", async () => {
    const harness = makeRuntimeHarness({
      waitForExit: () => Promise.reject("app server exited badly"),
    });

    await startRouterRuntime({
      config: {
        slackBotToken: "xoxb-test",
        slackAppToken: "xapp-test",
        allowedUserId: "U123",
        projectsFile: "/repo/config/projects.yaml",
        routerStateDb: "/repo/logs/router-v2.sqlite3",
        appServerCommand: ["codex", "app-server"],
      },
      store: harness.store,
      appServerProcess: {
        writeLine: vi.fn(),
        onLine: harness.onLine,
        waitForExit: harness.waitForExit,
      },
      appServerClient: harness.appServerClient,
      slackApp: harness.slackApp,
      routerService: {},
      registerSlackMessageHandler: harness.registerSlackMessageHandler,
    });

    await Promise.resolve();

    expect(harness.failPendingRequests).toHaveBeenCalledTimes(1);
    const [error] = harness.failPendingRequests.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("App Server process exited");
  });

  it("ignores event notifications for threads removed from the current recoverable set", async () => {
    const currentThreads = [
      {
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0001",
        appServerThreadId: "thread_abc",
        state: "idle" as const,
        worktreePath: "/tmp/wt",
        branchName: "codex/slack/1710000000-0001",
        baseBranch: "main",
      },
    ];
    const harness = makeRuntimeHarness({
      recoverableThreads: currentThreads,
    });
    const notifications: Array<(notification: {
      method: string;
      params: Record<string, unknown>;
    }) => void> = [];
    harness.appServerClient.events.subscribe = vi.fn((listener) => {
      notifications.push(listener);
      return () => {};
    });

    await startRouterRuntime({
      config: {
        slackBotToken: "xoxb-test",
        slackAppToken: "xapp-test",
        allowedUserId: "U123",
        projectsFile: "/repo/config/projects.yaml",
        routerStateDb: "/repo/logs/router-v2.sqlite3",
        appServerCommand: ["codex", "app-server"],
      },
      store: harness.store,
      appServerProcess: {
        writeLine: vi.fn(),
        onLine: harness.onLine,
        waitForExit: harness.waitForExit,
      },
      appServerClient: harness.appServerClient,
      slackApp: harness.slackApp,
      routerService: {},
      registerSlackMessageHandler: harness.registerSlackMessageHandler,
    });
    harness.upsertThread.mockClear();

    currentThreads.length = 0;

    notifications[0]?.({
      method: "item/completed",
      params: {
        threadId: "thread_abc",
        item: {
          type: "message",
          role: "assistant",
          text: "Should not post.",
        },
      },
    });

    await Promise.resolve();

    expect(harness.upsertThread).not.toHaveBeenCalled();
    expect(harness.postMessage).not.toHaveBeenCalled();
  });
});
