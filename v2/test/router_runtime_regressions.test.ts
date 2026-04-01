import { describe, expect, it, vi } from "vitest";
import { AppServerEventStream, parseAppServerLine } from "../src/app_server/events.js";
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
  it("detaches runtime listeners and fails pending requests if initialization rejects", async () => {
    const detachEventListener = vi.fn();
    const detachLineListener = vi.fn();
    const initializeError = new Error("initialize failed");
    const harness = makeRuntimeHarness({
      waitForExit: () => new Promise<number | null>(() => {}),
    });
    harness.initialize.mockRejectedValueOnce(initializeError);
    harness.subscribe.mockReturnValueOnce(detachEventListener);
    harness.onLine.mockReturnValueOnce(detachLineListener);

    await expect(
      startRouterRuntime({
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
      }),
    ).rejects.toThrow("initialize failed");

    expect(detachEventListener).toHaveBeenCalledTimes(1);
    expect(detachLineListener).toHaveBeenCalledTimes(1);
    expect(harness.failPendingRequests).toHaveBeenCalledTimes(1);
    expect(harness.failPendingRequests).toHaveBeenCalledWith(initializeError);
  });

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

  it("clears a stale restart intent without posting when the requesting thread was not recovered", async () => {
    const harness = makeRuntimeHarness({
      pendingRestartIntent: {
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0099",
        requestedAt: "2026-03-30T12:00:00Z",
      },
      recoverableThreads: [
        {
          slackChannelId: "C456",
          slackThreadTs: "1710000000.0002",
          appServerThreadId: "thread_def",
          state: "running",
          worktreePath: "/tmp/wt-2",
          branchName: "codex/slack/1710000000-0002",
          baseBranch: "main",
        },
      ],
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

    expect(harness.postMessage).not.toHaveBeenCalled();
    expect(harness.clearRestartIntent).toHaveBeenCalledTimes(1);
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

  it("detaches line and event listeners once the app server exit resolves", async () => {
    const lineListeners = new Set<(line: string) => void>();
    const eventStream = new AppServerEventStream();
    const threadRecord = {
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_abc",
      activeTurnId: "turn_abc",
      state: "running" as const,
      worktreePath: "/tmp/wt",
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    };
    let resolveExit!: (code: number | null) => void;
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const failPendingRequests = vi.fn();
    const detachEventListener = vi.fn();
    const detachLineListener = vi.fn();

    await startRouterRuntime({
      config: {
        slackBotToken: "xoxb-test",
        slackAppToken: "xapp-test",
        allowedUserId: "U123",
        projectsFile: "/repo/config/projects.yaml",
        routerStateDb: "/repo/logs/router-v2.sqlite3",
        appServerCommand: ["codex", "app-server"],
      },
      store: {
        getPendingRestartIntent: vi.fn().mockReturnValue(null),
        listRecoverableThreads: vi.fn().mockReturnValue([threadRecord]),
        clearRestartIntent: vi.fn(),
        upsertThread: vi.fn(),
      },
      appServerProcess: {
        writeLine: vi.fn(),
        onLine: vi.fn((listener: (line: string) => void) => {
          lineListeners.add(listener);
          return () => {
            detachLineListener();
            lineListeners.delete(listener);
          };
        }),
        waitForExit: vi.fn(
          () =>
            new Promise<number | null>((resolve) => {
              resolveExit = resolve;
            }),
        ),
      },
      appServerClient: {
        initialize: vi.fn().mockResolvedValue(undefined),
        handleLine: vi.fn((line: string) => {
          const message = parseAppServerLine(line);
          if (message?.kind === "notification") {
            eventStream.emit(message.notification);
          }
        }),
        failPendingRequests,
        events: {
          subscribe: (listener) => {
            const unsubscribe = eventStream.subscribe(listener);
            return () => {
              detachEventListener();
              unsubscribe();
            };
          },
        },
        threadStart: vi.fn(),
        turnStart: vi.fn(),
      },
      slackApp: {
        start: vi.fn().mockResolvedValue(undefined),
        client: {
          chat: {
            postMessage,
          },
        },
        event: vi.fn(),
      },
      routerService: {},
      registerSlackMessageHandler: vi.fn(),
    });

    resolveExit(0);
    await Promise.resolve();
    await Promise.resolve();

    const lateNotification = JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "thread_abc",
        item: {
          type: "agentMessage",
          text: "Should not be delivered after exit",
          phase: "final_answer",
        },
      },
    });

    for (const listener of lineListeners) {
      listener(lateNotification);
    }

    eventStream.emit({
      method: "item/completed",
      params: {
        threadId: "thread_abc",
        item: {
          type: "agentMessage",
          text: "Should not be delivered after exit",
          phase: "final_answer",
        },
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(detachLineListener).toHaveBeenCalledTimes(1);
    expect(detachEventListener).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
    expect(failPendingRequests).toHaveBeenCalledWith(new Error("App Server process exited"));
  });
});
