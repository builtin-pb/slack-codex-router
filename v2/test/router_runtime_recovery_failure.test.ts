import { describe, expect, it, vi } from "vitest";
import { startRouterRuntime } from "../src/router/runtime.js";

function makeRuntimeHarness() {
  const registerSlackMessageHandler = vi.fn();
  const initialize = vi.fn().mockResolvedValue(undefined);
  const handleLine = vi.fn();
  const failPendingRequests = vi.fn();
  const subscribe = vi.fn().mockReturnValue(() => {});
  const onLine = vi.fn().mockReturnValue(() => {});
  const waitForExit = vi.fn().mockResolvedValue(0);
  const postMessage = vi.fn().mockRejectedValue(new Error("slack unavailable"));
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
    store,
    appServerClient,
    slackApp,
  };
}

describe("startRouterRuntime restart recovery failure", () => {
  it("leaves restart intent intact when the recovery post fails", async () => {
    const harness = makeRuntimeHarness();

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
    ).rejects.toThrow("slack unavailable");

    expect(harness.postMessage).toHaveBeenCalledTimes(1);
    expect(harness.clearRestartIntent).not.toHaveBeenCalled();
  });
});
