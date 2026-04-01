import { describe, expect, it, vi } from "vitest";
import { startRouterRuntime } from "../src/router/runtime.js";
import type { RestartIntent } from "../src/domain/types.js";

function makeRuntimeHarness(options: {
  failRecoveryPost?: boolean;
  nextRestartIntentDuringRecovery?: RestartIntent;
} = {}) {
  const registerSlackMessageHandler = vi.fn();
  const initialize = vi.fn().mockResolvedValue(undefined);
  const handleLine = vi.fn();
  const failPendingRequests = vi.fn();
  const subscribe = vi.fn().mockReturnValue(() => {});
  const onLine = vi.fn().mockReturnValue(() => {});
  const waitForExit = vi.fn().mockResolvedValue(0);
  let pendingRestartIntent: RestartIntent | null = {
    slackChannelId: "C123",
    slackThreadTs: "1710000000.0001",
    requestedAt: "2026-03-30T12:00:00Z",
  };
  const postMessage = vi.fn().mockImplementation(async () => {
    if (options.failRecoveryPost) {
      throw new Error("recovery slack unavailable");
    }

    if (options.nextRestartIntentDuringRecovery) {
      pendingRestartIntent = options.nextRestartIntentDuringRecovery;
    }

    return undefined;
  });
  const start = vi.fn().mockResolvedValue(undefined);
  const clearRestartIntent = vi.fn();
  const clearRestartIntentIfMatches = vi.fn((intent: RestartIntent) => {
    if (
      pendingRestartIntent &&
      pendingRestartIntent.slackChannelId === intent.slackChannelId &&
      pendingRestartIntent.slackThreadTs === intent.slackThreadTs &&
      pendingRestartIntent.requestedAt === intent.requestedAt
    ) {
      pendingRestartIntent = null;
      return true;
    }

    return false;
  });
  const upsertThread = vi.fn();
  const recordRestartIntent = vi.fn((intent: RestartIntent) => {
    pendingRestartIntent = intent;
  });

  const store = {
    getPendingRestartIntent: vi.fn(() => pendingRestartIntent),
    listRecoverableThreads: vi.fn().mockReturnValue([
      {
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0001",
        appServerThreadId: "thread_abc",
        state: "running",
        worktreePath: "/tmp/wt",
        branchName: "codex/slack/1710000000-0001",
        baseBranch: "main",
      },
    ]),
    clearRestartIntent,
    clearRestartIntentIfMatches,
    recordRestartIntent,
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
    failPendingRequests,
    subscribe,
    onLine,
    waitForExit,
    postMessage,
    start,
    clearRestartIntent,
    clearRestartIntentIfMatches,
    recordRestartIntent,
    store,
    appServerClient,
    slackApp,
  };
}

describe("startRouterRuntime restart recovery failure", () => {
  it("keeps the restart intent when the recovery post fails", async () => {
    const harness = makeRuntimeHarness({
      failRecoveryPost: true,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

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
    ).resolves.toBeUndefined();

    expect(harness.postMessage).toHaveBeenCalledTimes(1);
    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(harness.registerSlackMessageHandler).toHaveBeenCalledTimes(1);
    expect(harness.clearRestartIntentIfMatches).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to post restart recovery notice",
      expect.any(Error),
    );
    expect(harness.store.getPendingRestartIntent()).toEqual({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });
    expect(harness.clearRestartIntent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not clear a failed recovery restart intent through the legacy fallback path", async () => {
    const harness = makeRuntimeHarness({
      failRecoveryPost: true,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

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
        store: {
          ...harness.store,
          clearRestartIntentIfMatches: undefined,
        },
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
    ).resolves.toBeUndefined();

    expect(harness.postMessage).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to post restart recovery notice",
      expect.any(Error),
    );
    expect(harness.clearRestartIntent).not.toHaveBeenCalled();
    expect(harness.store.getPendingRestartIntent()).toEqual({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });
    consoleError.mockRestore();
  });

  it("preserves a newer restart intent that arrives while recovery is posting", async () => {
    const newerRestartIntent = {
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0002",
      requestedAt: "2026-03-30T12:00:01Z",
    } satisfies RestartIntent;
    const harness = makeRuntimeHarness({
      nextRestartIntentDuringRecovery: newerRestartIntent,
    });

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
    ).resolves.toBeUndefined();

    expect(harness.postMessage).toHaveBeenCalledTimes(1);
    expect(harness.clearRestartIntentIfMatches).toHaveBeenCalledTimes(1);
    expect(harness.clearRestartIntentIfMatches).toHaveBeenCalledWith({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });
    expect(harness.clearRestartIntent).not.toHaveBeenCalled();
    expect(harness.store.getPendingRestartIntent()).toEqual(newerRestartIntent);
  });

  it("atomically keeps a newer restart intent when recovery finishes after the overwrite", async () => {
    const newerRestartIntent = {
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0002",
      requestedAt: "2026-03-30T12:00:01Z",
    } satisfies RestartIntent;
    const harness = makeRuntimeHarness({
      nextRestartIntentDuringRecovery: newerRestartIntent,
    });

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
    ).resolves.toBeUndefined();

    expect(harness.clearRestartIntentIfMatches).toHaveBeenCalledTimes(1);
    expect(harness.clearRestartIntentIfMatches).toHaveBeenCalledWith({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });
    expect(harness.store.getPendingRestartIntent()).toEqual(newerRestartIntent);
    expect(harness.clearRestartIntent).not.toHaveBeenCalled();
  });
});
