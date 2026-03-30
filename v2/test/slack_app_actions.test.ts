import { describe, expect, it, vi } from "vitest";
import type { RouterService } from "../src/router/service.js";
import { registerSlackMessageHandler } from "../src/slack/app.js";

type ActionListenerArgs = {
  action?: { action_id?: string; value?: string };
  body: {
    channel?: { id?: string };
    message?: { thread_ts?: string; ts?: string };
    user?: { id?: string };
  };
  ack: ReturnType<typeof vi.fn>;
  respond: ReturnType<typeof vi.fn>;
};

describe("registerSlackMessageHandler actions", () => {
  it("binds action registration to the original app instance", () => {
    const actionMatchers: Array<string | RegExp> = [];
    const app = {
      listeners: actionMatchers,
      event: vi.fn(),
      action(this: { listeners: Array<string | RegExp> }, matcher: string | RegExp) {
        this.listeners.push(matcher);
      },
    };

    expect(() =>
      registerSlackMessageHandler(
        app,
        {
          handleSlackMessage: vi.fn(),
          interruptThread: vi.fn(),
          submitChoice: vi.fn(),
          startReview: vi.fn(),
          restartRouter: vi.fn(),
          mergeToMain: vi.fn(),
          confirmMergeToMain: vi.fn(),
          getThreadStatus: vi.fn(),
        } as unknown as RouterService,
      ),
    ).not.toThrow();

    expect(actionMatchers).toContain("status");
    expect(actionMatchers).toContain("restart_router");
  });

  it("registers live handlers for every rendered thread control", () => {
    const actionMatchers: Array<string | RegExp> = [];

    registerSlackMessageHandler(
      {
        event: vi.fn(),
        action(matcher) {
          actionMatchers.push(matcher);
        },
      },
      {
        handleSlackMessage: vi.fn(),
        interruptThread: vi.fn(),
        submitChoice: vi.fn(),
        startReview: vi.fn(),
        restartRouter: vi.fn(),
        mergeToMain: vi.fn(),
        confirmMergeToMain: vi.fn(),
        getThreadStatus: vi.fn(),
      } as unknown as RouterService,
    );

    expect(actionMatchers).toEqual([
      "status",
      "interrupt",
      "review",
      /^codex_choice:/,
      "what_changed",
      "open_diff",
      "merge_to_main",
      "confirm_merge_to_main",
      "restart_router",
      "archive_task",
    ]);
  });

  it("routes status, interrupt, review, restart, merge preview, merge confirm, placeholder, and choice actions into router controls", async () => {
    const router = {
      handleSlackMessage: vi.fn(),
      interruptThread: vi.fn().mockResolvedValue(undefined),
      submitChoice: vi.fn().mockResolvedValue(undefined),
      startReview: vi.fn().mockResolvedValue(undefined),
      restartRouter: vi.fn().mockResolvedValue({
        exitCode: 75,
        message: "Router restart requested.",
      }),
      mergeToMain: vi.fn().mockResolvedValue({
        text: "Merge feature into main?",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Merge feature into main?",
            },
          },
        ],
      }),
      confirmMergeToMain: vi.fn().mockResolvedValue({
        text: "Merged feature into main.",
      }),
      getThreadStatus: vi.fn().mockReturnValue({
        state: "running",
        branchName: "codex/slack/1710000000-0001",
        worktreePath: "/repo/.codex-worktrees/1710000000-0001",
        appServerThreadId: "thread_abc",
        activeTurnId: "turn_abc",
      }),
    };
    const actionHandlers = new Map<string, (args: ActionListenerArgs) => Promise<void>>();
    let choiceHandler:
      | ((args: ActionListenerArgs) => Promise<void>)
      | undefined;
    const requestProcessExit = vi.fn();

    registerSlackMessageHandler(
      {
        event: vi.fn(),
        action(matcher, listener) {
          if (matcher instanceof RegExp) {
            choiceHandler = listener as (args: ActionListenerArgs) => Promise<void>;
            return;
          }

          actionHandlers.set(matcher, listener as (args: ActionListenerArgs) => Promise<void>);
        },
      },
      router as unknown as RouterService,
      { requestProcessExit },
    );

    const statusAck = vi.fn().mockResolvedValue(undefined);
    const statusRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("status")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: statusAck,
      respond: statusRespond,
    });

    const interruptAck = vi.fn().mockResolvedValue(undefined);
    const interruptRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("interrupt")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: interruptAck,
      respond: interruptRespond,
    });

    const reviewAck = vi.fn().mockResolvedValue(undefined);
    const reviewRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("review")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: reviewAck,
      respond: reviewRespond,
    });

    const restartAck = vi.fn().mockResolvedValue(undefined);
    const restartRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("restart_router")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: restartAck,
      respond: restartRespond,
    });

    const mergeAck = vi.fn().mockResolvedValue(undefined);
    const mergeRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("merge_to_main")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: mergeAck,
      respond: mergeRespond,
    });

    const confirmMergeAck = vi.fn().mockResolvedValue(undefined);
    const confirmMergeRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("confirm_merge_to_main")?.({
      action: { action_id: "confirm_merge_to_main", value: "feature:main" },
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: confirmMergeAck,
      respond: confirmMergeRespond,
    });

    const whatChangedAck = vi.fn().mockResolvedValue(undefined);
    const whatChangedRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("what_changed")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: whatChangedAck,
      respond: whatChangedRespond,
    });

    const openDiffAck = vi.fn().mockResolvedValue(undefined);
    const openDiffRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("open_diff")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: openDiffAck,
      respond: openDiffRespond,
    });

    const archiveAck = vi.fn().mockResolvedValue(undefined);
    const archiveRespond = vi.fn().mockResolvedValue(undefined);
    await actionHandlers.get("archive_task")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: archiveAck,
      respond: archiveRespond,
    });

    const choiceAck = vi.fn().mockResolvedValue(undefined);
    const choiceRespond = vi.fn().mockResolvedValue(undefined);
    await choiceHandler?.({
      action: { action_id: "codex_choice:approve", value: "approve" },
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack: choiceAck,
      respond: choiceRespond,
    });

    expect(router.getThreadStatus).toHaveBeenCalledWith(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
    );
    expect(statusAck).toHaveBeenCalledTimes(1);
    expect(statusRespond).toHaveBeenCalledWith({
      text: expect.stringContaining("State: running"),
      replace_original: false,
    });
    expect(statusRespond).toHaveBeenCalledWith({
      text: expect.stringContaining("Branch: codex/slack/1710000000-0001"),
      replace_original: false,
    });
    expect(statusRespond).toHaveBeenCalledWith({
      text: expect.stringContaining("Worktree: /repo/.codex-worktrees/1710000000-0001"),
      replace_original: false,
    });

    expect(router.interruptThread).toHaveBeenCalledWith(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
    );
    expect(interruptAck).toHaveBeenCalledTimes(1);
    expect(interruptRespond).toHaveBeenCalledWith({
      text: "Interrupted current turn.",
      replace_original: false,
    });

    expect(router.startReview).toHaveBeenCalledWith(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
    );
    expect(reviewAck).toHaveBeenCalledTimes(1);
    expect(reviewRespond).toHaveBeenCalledWith({
      text: "Started review for uncommitted changes.",
      replace_original: false,
    });

    expect(router.restartRouter).toHaveBeenCalledWith(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
    );
    expect(restartAck).toHaveBeenCalledTimes(1);
    expect(restartRespond).toHaveBeenCalledWith({
      text: "Router restart requested.",
      replace_original: false,
    });
    expect(restartRespond.mock.invocationCallOrder[0]).toBeLessThan(
      requestProcessExit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(requestProcessExit).toHaveBeenCalledWith(75);

    expect(router.mergeToMain).toHaveBeenCalledWith(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
    );
    expect(mergeAck).toHaveBeenCalledTimes(1);
    expect(mergeRespond).toHaveBeenCalledWith({
      text: "Merge feature into main?",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Merge feature into main?",
          },
        },
      ],
      replace_original: false,
    });

    expect(router.confirmMergeToMain).toHaveBeenCalledWith(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
      {
        sourceBranch: "feature",
        targetBranch: "main",
      },
    );
    expect(confirmMergeAck).toHaveBeenCalledTimes(1);
    expect(confirmMergeRespond).toHaveBeenCalledWith({
      text: "Merged feature into main.",
      replace_original: false,
    });

    expect(whatChangedAck).toHaveBeenCalledTimes(1);
    expect(whatChangedRespond).toHaveBeenCalledWith({
      text: "Diff summaries are not wired into Slack yet.",
      replace_original: false,
    });

    expect(openDiffAck).toHaveBeenCalledTimes(1);
    expect(openDiffRespond).toHaveBeenCalledWith({
      text: "Diff links are not wired into Slack yet.",
      replace_original: false,
    });

    expect(archiveAck).toHaveBeenCalledTimes(1);
    expect(archiveRespond).toHaveBeenCalledWith({
      text: "Archiving tasks is not wired into Slack yet.",
      replace_original: false,
    });

    expect(router.submitChoice).toHaveBeenCalledWith(
      "U123",
      "C08TEMPLATE",
      "1710000000.0001",
      "approve",
    );
    expect(choiceAck).toHaveBeenCalledTimes(1);
    expect(choiceRespond).toHaveBeenCalledWith({
      text: "Submitted choice: approve",
      replace_original: false,
    });
  });

  it("responds with a compact error when a control action fails", async () => {
    const actionHandlers = new Map<string, (args: ActionListenerArgs) => Promise<void>>();

    registerSlackMessageHandler(
      {
        event: vi.fn(),
        action(matcher, listener) {
          if (typeof matcher === "string") {
            actionHandlers.set(matcher, listener as (args: ActionListenerArgs) => Promise<void>);
          }
        },
      },
      {
        handleSlackMessage: vi.fn(),
        interruptThread: vi
          .fn()
          .mockRejectedValue(new Error("No active turn recorded for this Slack thread.")),
        submitChoice: vi.fn(),
        startReview: vi.fn(),
        restartRouter: vi.fn(),
        mergeToMain: vi.fn(),
        confirmMergeToMain: vi.fn(),
        getThreadStatus: vi.fn(),
      } as unknown as RouterService,
    );

    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);

    await actionHandlers.get("interrupt")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack,
      respond,
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      text: "No active turn recorded for this Slack thread.",
      replace_original: false,
    });
  });

  it("rejects malformed merge confirmations before reaching the router", async () => {
    const actionHandlers = new Map<string, (args: ActionListenerArgs) => Promise<void>>();
    const confirmMergeToMain = vi.fn();

    registerSlackMessageHandler(
      {
        event: vi.fn(),
        action(matcher, listener) {
          if (typeof matcher === "string") {
            actionHandlers.set(matcher, listener as (args: ActionListenerArgs) => Promise<void>);
          }
        },
      },
      {
        handleSlackMessage: vi.fn(),
        interruptThread: vi.fn(),
        submitChoice: vi.fn(),
        startReview: vi.fn(),
        restartRouter: vi.fn(),
        mergeToMain: vi.fn(),
        confirmMergeToMain,
        getThreadStatus: vi.fn(),
      } as unknown as RouterService,
    );

    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);

    await actionHandlers.get("confirm_merge_to_main")?.({
      action: { action_id: "confirm_merge_to_main", value: "feature:" },
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U123" },
      },
      ack,
      respond,
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(confirmMergeToMain).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      text: "Malformed merge confirmation.",
      replace_original: false,
    });
  });

  it("rejects interactive actions from unauthorized users", async () => {
    const actionHandlers = new Map<string, (args: ActionListenerArgs) => Promise<void>>();

    registerSlackMessageHandler(
      {
        event: vi.fn(),
        action(matcher, listener) {
          if (typeof matcher === "string") {
            actionHandlers.set(matcher, listener as (args: ActionListenerArgs) => Promise<void>);
          }
        },
      },
      {
        handleSlackMessage: vi.fn(),
        interruptThread: vi
          .fn()
          .mockRejectedValue(new Error("User is not allowed to control this router.")),
        submitChoice: vi.fn(),
        startReview: vi.fn(),
        restartRouter: vi.fn(),
        mergeToMain: vi.fn(),
        confirmMergeToMain: vi.fn(),
        getThreadStatus: vi.fn(),
      } as unknown as RouterService,
    );

    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);

    await actionHandlers.get("interrupt")?.({
      body: {
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
        user: { id: "U999" },
      },
      ack,
      respond,
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      text: "User is not allowed to control this router.",
      replace_original: false,
    });
  });
});
