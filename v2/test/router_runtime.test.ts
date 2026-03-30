import { describe, expect, it, vi } from "vitest";
import { startRouterRuntime } from "../src/router/runtime.js";

describe("startRouterRuntime", () => {
  it("initializes the app server client, registers Slack handlers, and posts a recovery update", async () => {
    const registerSlackMessageHandler = vi.fn();
    const initialize = vi.fn().mockResolvedValue(undefined);
    const handleLine = vi.fn();
    const failPendingRequests = vi.fn();
    const subscribe = vi.fn().mockReturnValue(() => {});
    const onLine = vi.fn().mockReturnValue(() => {});
    const waitForExit = vi.fn().mockResolvedValue(0);
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockResolvedValue(undefined);
    const clearRestartIntent = vi.fn();
    const upsertThread = vi.fn();

    const store = {
      getPendingRestartIntent: vi.fn().mockReturnValue({
        slackChannelId: "C123",
        slackThreadTs: "1710000000.0001",
        requestedAt: "2026-03-30T12:00:00Z",
      }),
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
      upsertThread,
    };

    await startRouterRuntime({
      config: {
        slackBotToken: "xoxb-test",
        slackAppToken: "xapp-test",
        allowedUserId: "U123",
        projectsFile: "/repo/config/projects.yaml",
        routerStateDb: "/repo/logs/router-v2.sqlite3",
        appServerCommand: ["codex", "app-server"],
      },
      store,
      appServerProcess: {
        writeLine: vi.fn(),
        onLine,
        waitForExit,
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
      routerService: {},
      registerSlackMessageHandler,
    });

    expect(onLine).toHaveBeenCalledTimes(1);
    const lineListener = onLine.mock.calls[0]?.[0];
    expect(lineListener).toBeTypeOf("function");
    lineListener?.('{"method":"thread/status/changed","params":{"threadId":"thread_abc"}}');
    expect(handleLine).toHaveBeenCalledWith(
      '{"method":"thread/status/changed","params":{"threadId":"thread_abc"}}',
    );

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(registerSlackMessageHandler).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      text: "Router restarted. Recovered 1 thread mapping(s).",
      thread_ts: "1710000000.0001",
    });
    expect(upsertThread).toHaveBeenCalledWith({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_abc",
      activeTurnId: null,
      appServerSessionStale: true,
      state: "interrupted",
      worktreePath: "/tmp/wt",
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });
    expect(clearRestartIntent).toHaveBeenCalledTimes(1);

    await waitForExit.mock.results[0]?.value;
    expect(failPendingRequests).toHaveBeenCalledWith(new Error("App Server process exited"));
  });
});
