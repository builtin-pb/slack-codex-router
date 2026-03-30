import type { RouterService } from "../router/service.js";

export type SlackActionAckFn = () => Promise<unknown>;
export type SlackActionRespondFn = (message: {
  text: string;
  replace_original?: boolean;
  blocks?: unknown[];
}) => Promise<unknown>;

type MergeSelection = {
  sourceBranch: string;
  targetBranch: string;
};

type SlackActionBody = {
  channel?: { id?: string };
  message?: { thread_ts?: string; ts?: string };
  user?: { id?: string };
};

type SlackAction = {
  action_id?: string;
  value?: string;
};

type SlackActionArgs = {
  action?: SlackAction;
  body: SlackActionBody;
  ack: SlackActionAckFn;
  respond: SlackActionRespondFn;
};

export type SlackControlActionApp = {
  action(
    matcher: string | RegExp,
    listener: (args: SlackActionArgs) => Promise<void>,
  ): void;
};

export function registerThreadControlActions(
  app: SlackControlActionApp,
  router: Pick<
    RouterService,
    | "getThreadStatus"
    | "interruptThread"
    | "startReview"
    | "submitChoice"
    | "restartRouter"
    | "mergeToMain"
    | "confirmMergeToMain"
  >,
  options: {
    requestProcessExit?(exitCode: number): void;
  } = {},
): void {
  app.action("status", async ({ ack, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const status = router.getThreadStatus(userId, channelId, threadTs);
      if (!status) {
        return "No stored Codex session for this Slack thread.";
      }

      return renderThreadStatus(status);
    });
  });

  app.action("interrupt", async ({ ack, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      await router.interruptThread(userId, channelId, threadTs);
      return "Interrupted current turn.";
    });
  });

  app.action("review", async ({ ack, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      await router.startReview(userId, channelId, threadTs);
      return "Started review for uncommitted changes.";
    });
  });

  app.action(/^codex_choice:/, async ({ ack, action, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const choice = resolveChoiceValue(action);
      await router.submitChoice(userId, channelId, threadTs, choice);
      return `Submitted choice: ${choice}`;
    });
  });

  app.action("what_changed", async ({ ack, respond }) => {
    await handleAction(ack, respond, async () => {
      return "Diff summaries are not wired into Slack yet.";
    });
  });

  app.action("open_diff", async ({ ack, respond }) => {
    await handleAction(ack, respond, async () => {
      return "Diff links are not wired into Slack yet.";
    });
  });

  app.action("merge_to_main", async ({ ack, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      return router.mergeToMain(userId, channelId, threadTs);
    });
  });

  app.action("confirm_merge_to_main", async ({ ack, action, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const rawSelection = action?.value?.trim();
      const expectedSelection = parseMergeSelection(action);
      if (rawSelection && !expectedSelection) {
        throw new Error("Malformed merge confirmation.");
      }
      return router.confirmMergeToMain(userId, channelId, threadTs, expectedSelection);
    });
  });

  app.action("restart_router", async ({ ack, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const result = await router.restartRouter(userId, channelId, threadTs);
      return {
        text: result.message,
        afterRespond: async () => {
          options.requestProcessExit?.(result.exitCode);
        },
      };
    });
  });

  app.action("archive_task", async ({ ack, respond }) => {
    await handleAction(ack, respond, async () => {
      return "Archiving tasks is not wired into Slack yet.";
    });
  });
}

async function handleAction(
  ack: SlackActionAckFn,
  respond: SlackActionRespondFn,
  action: () => Promise<
    | string
    | { text: string; blocks?: unknown[]; afterRespond?: () => void | Promise<void> }
  >,
): Promise<void> {
  await ack();

  try {
    const result = await action();
    if (typeof result === "string") {
      if (!result) {
        return;
      }

      await respond({
        text: result,
        replace_original: false,
      });
      return;
    }

    await respond({
      text: result.text,
      blocks: result.blocks,
      replace_original: false,
    });
    await result.afterRespond?.();
  } catch (error) {
    await respond({
      text: toErrorMessage(error),
      replace_original: false,
    });
  }
}

function getActionContext(body: SlackActionBody): {
  userId: string;
  channelId: string;
  threadTs: string;
} {
  return {
    userId: body.user?.id ?? "",
    channelId: body.channel?.id ?? "",
    threadTs: body.message?.thread_ts ?? body.message?.ts ?? "",
  };
}

function resolveChoiceValue(action?: SlackAction): string {
  if (action?.value?.trim()) {
    return action.value.trim();
  }

  const actionId = action?.action_id ?? "";
  const [, choice = ""] = actionId.split("codex_choice:");
  return choice.trim();
}

function parseMergeSelection(action?: SlackAction): MergeSelection | undefined {
  const value = action?.value?.trim();
  if (!value) {
    return undefined;
  }

  const separatorIndex = value.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return undefined;
  }

  return {
    sourceBranch: value.slice(0, separatorIndex),
    targetBranch: value.slice(separatorIndex + 1),
  };
}

function renderThreadStatus(status: {
  state: string;
  branchName: string;
  worktreePath: string;
  activeTurnId?: string | null;
  appServerThreadId: string;
}): string {
  const parts = [
    `State: ${status.state}`,
    `Branch: ${status.branchName}`,
    `Worktree: ${status.worktreePath}`,
    `Thread: ${status.appServerThreadId}`,
  ];

  if (status.activeTurnId) {
    parts.push(`Turn: ${status.activeTurnId}`);
  }

  return parts.join(" | ");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Action failed.";
}
