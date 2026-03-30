import { describe, expect, it, vi } from "vitest";
import { startRouterRuntime } from "../src/router/runtime.js";

type NotificationListener = (notification: {
  method: string;
  params: Record<string, unknown>;
}) => void;

function makeRuntimeHarness() {
  const notifications: NotificationListener[] = [];
  const registerSlackMessageHandler = vi.fn();
  const initialize = vi.fn().mockResolvedValue(undefined);
  const handleLine = vi.fn();
  const failPendingRequests = vi.fn();
  const subscribe = vi.fn((listener: NotificationListener) => {
    notifications.push(listener);
    return () => {};
  });
  const onLine = vi.fn().mockReturnValue(() => {});
  const waitForExit = vi.fn().mockResolvedValue(0);
  const postMessage = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn().mockResolvedValue(undefined);
  const upsertThread = vi.fn();
  const threadRecord = {
    slackChannelId: "C123",
    slackThreadTs: "1710000000.0001",
    appServerThreadId: "thread_abc",
    activeTurnId: "turn_abc",
    state: "idle" as const,
    worktreePath: "/tmp/wt",
    branchName: "codex/slack/1710000000-0001",
    baseBranch: "main",
  };

  return {
    notifications,
    postMessage,
    upsertThread,
    registerSlackMessageHandler,
    store: {
      getPendingRestartIntent: vi.fn().mockReturnValue(null),
      listRecoverableThreads: vi.fn().mockReturnValue([threadRecord]),
      clearRestartIntent: vi.fn(),
      upsertThread,
    },
    appServerClient: {
      initialize,
      handleLine,
      failPendingRequests,
      events: {
        subscribe,
      },
      threadStart: vi.fn(),
      turnStart: vi.fn(),
    },
    slackApp: {
      start,
      client: {
        chat: {
          postMessage,
        },
      },
      event: vi.fn(),
    },
    threadRecord,
  };
}

describe("startRouterRuntime event bridge", () => {
  it("posts completed assistant messages from item notifications without changing thread state", async () => {
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
        onLine: vi.fn().mockReturnValue(() => {}),
        waitForExit: vi.fn().mockResolvedValue(0),
      },
      appServerClient: harness.appServerClient,
      slackApp: harness.slackApp,
      routerService: {},
      registerSlackMessageHandler: harness.registerSlackMessageHandler,
    });

    const listener = harness.notifications[0];
    expect(listener).toBeTypeOf("function");

    listener?.({
      method: "item/completed",
      params: {
        threadId: "thread_abc",
        item: {
          type: "message",
          role: "assistant",
          text: "Working on it.",
        },
      },
    });

    await Promise.resolve();

    expect(harness.postMessage).toHaveBeenCalledWith({
      channel: "C123",
      text: "Working on it.",
      thread_ts: "1710000000.0001",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Working on it.",
          },
        },
        {
          type: "actions",
          elements: expect.arrayContaining([
            expect.objectContaining({ action_id: "status" }),
            expect.objectContaining({ action_id: "restart_router" }),
            expect.objectContaining({ action_id: "archive_task" }),
          ]),
        },
      ],
    });
    expect(harness.upsertThread).not.toHaveBeenCalled();
  });

  it("persists thread-scoped status changes by app server thread id", async () => {
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
        onLine: vi.fn().mockReturnValue(() => {}),
        waitForExit: vi.fn().mockResolvedValue(0),
      },
      appServerClient: harness.appServerClient,
      slackApp: harness.slackApp,
      routerService: {},
      registerSlackMessageHandler: harness.registerSlackMessageHandler,
    });

    harness.notifications[0]?.({
      method: "thread/status/changed",
      params: {
        threadId: "thread_abc",
        state: "running",
      },
    });

    await Promise.resolve();

    expect(harness.upsertThread).toHaveBeenCalledWith({
      ...harness.threadRecord,
      state: "running",
    });
    expect(harness.postMessage).not.toHaveBeenCalled();
  });

  it("clears stale active turn ids when the app server marks the thread idle", async () => {
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
        onLine: vi.fn().mockReturnValue(() => {}),
        waitForExit: vi.fn().mockResolvedValue(0),
      },
      appServerClient: harness.appServerClient,
      slackApp: harness.slackApp,
      routerService: {},
      registerSlackMessageHandler: harness.registerSlackMessageHandler,
    });

    harness.notifications[0]?.({
      method: "thread/status/changed",
      params: {
        threadId: "thread_abc",
        state: "idle",
      },
    });

    await Promise.resolve();

    expect(harness.upsertThread).toHaveBeenCalledWith({
      ...harness.threadRecord,
      activeTurnId: null,
      state: "idle",
    });
  });

  it("posts user-input prompts with blocks and persists awaiting_user_input state", async () => {
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
        onLine: vi.fn().mockReturnValue(() => {}),
        waitForExit: vi.fn().mockResolvedValue(0),
      },
      appServerClient: harness.appServerClient,
      slackApp: harness.slackApp,
      routerService: {},
      registerSlackMessageHandler: harness.registerSlackMessageHandler,
    });

    harness.notifications[0]?.({
      method: "tool/requestUserInput",
      params: {
        threadId: "thread_abc",
        turnId: "turn_abc",
        itemId: "item_abc",
        questions: [
          {
            id: "approval",
            header: "Approval",
            question: "Need approval to continue.",
            options: [
              { label: "Approve", description: "Continue the task" },
              { label: "Revise", description: "Request changes" },
            ],
          },
        ],
      },
    });

    await Promise.resolve();

    expect(harness.postMessage).toHaveBeenCalledWith({
      channel: "C123",
      text: "Codex needs your input: Approval\nNeed approval to continue.",
      thread_ts: "1710000000.0001",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Codex needs your input*\nApproval\nNeed approval to continue.",
          },
        },
        {
          type: "actions",
          elements: expect.arrayContaining([
            expect.objectContaining({
              action_id: "codex_choice:approval-1",
              text: expect.objectContaining({ text: "Approve" }),
              value: "Approve",
            }),
            expect.objectContaining({
              action_id: "codex_choice:approval-2",
              text: expect.objectContaining({ text: "Revise" }),
              value: "Revise",
            }),
          ]),
        },
        {
          type: "actions",
          elements: expect.arrayContaining([
            expect.objectContaining({ action_id: "status" }),
            expect.objectContaining({ action_id: "what_changed" }),
            expect.objectContaining({ action_id: "open_diff" }),
            expect.objectContaining({ action_id: "restart_router" }),
            expect.objectContaining({ action_id: "archive_task" }),
          ]),
        },
      ],
    });
    expect(harness.upsertThread).toHaveBeenCalledWith({
      ...harness.threadRecord,
      state: "awaiting_user_input",
    });
  });

  it("catches Slack post failures during event bridging", async () => {
    const harness = makeRuntimeHarness();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    harness.postMessage.mockRejectedValueOnce(new Error("event slack unavailable"));

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
        onLine: vi.fn().mockReturnValue(() => {}),
        waitForExit: vi.fn().mockResolvedValue(0),
      },
      appServerClient: harness.appServerClient,
      slackApp: harness.slackApp,
      routerService: {},
      registerSlackMessageHandler: harness.registerSlackMessageHandler,
    });

    harness.notifications[0]?.({
      method: "item/completed",
      params: {
        threadId: "thread_abc",
        item: {
          type: "message",
          role: "assistant",
          text: "This post fails.",
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to bridge App Server notification",
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});
