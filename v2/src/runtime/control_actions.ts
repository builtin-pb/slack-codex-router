import type { RouterService } from "../router/service.js";

export type SlackActionAckFn = () => Promise<unknown>;
export type SlackActionRespondFn = (message: {
  text: string;
  replace_original?: boolean;
  blocks?: unknown[];
}) => Promise<unknown>;

type MergeSelection = {
  promptId?: number;
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

  app.action("interrupt", async ({ ack, action, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const expectedTurnId = resolveInterruptTurnId(action);
      if (!expectedTurnId) {
        throw new Error("Interrupt control is stale. Request the latest update and try again.");
      }
      await router.interruptThread(userId, channelId, threadTs, expectedTurnId);
      return "Interrupted current turn.";
    });
  });

  app.action("review", async ({ ack, action, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const expectedThreadId = resolveReviewThreadId(action);
      if (!expectedThreadId) {
        throw new Error("Review control is stale. Request the latest update and try again.");
      }
      await router.startReview(userId, channelId, threadTs, expectedThreadId);
      return "Started review for uncommitted changes.";
    });
  });

  app.action(/^codex_choice:/, async ({ ack, action, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const choice = resolveChoiceValue(action);
      const promptId = resolveChoicePromptId(action);
      await router.submitChoice(userId, channelId, threadTs, choice, promptId);
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

  app.action("merge_to_main", async ({ ack, action, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const expectedThreadId = resolveMergeThreadId(action);
      if (!expectedThreadId) {
        throw new Error("Merge preview control is stale. Request a fresh merge preview.");
      }
      return router.mergeToMain(userId, channelId, threadTs, expectedThreadId);
    });
  });

  app.action("confirm_merge_to_main", async ({ ack, action, body, respond }) => {
    await handleAction(ack, respond, async () => {
      const { userId, channelId, threadTs } = getActionContext(body);
      const rawSelection = action?.value?.trim();
      if (!rawSelection) {
        throw new Error("Malformed merge confirmation.");
      }
      const expectedSelection = parseMergeSelection(action);
      if (!expectedSelection) {
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

function resolveInterruptTurnId(action?: SlackAction): string | undefined {
  const value = action?.value?.trim();
  if (!value || !value.startsWith("interrupt:")) {
    return undefined;
  }

  const turnId = value.slice("interrupt:".length).trim();
  return turnId || undefined;
}

function resolveReviewThreadId(action?: SlackAction): string | undefined {
  const value = action?.value?.trim();
  if (!value || !value.startsWith("review:")) {
    return undefined;
  }

  const threadId = value.slice("review:".length).trim();
  return threadId || undefined;
}

function resolveMergeThreadId(action?: SlackAction): string | undefined {
  const value = action?.value?.trim();
  if (!value || !value.startsWith("merge_to_main:")) {
    return undefined;
  }

  const threadId = value.slice("merge_to_main:".length).trim();
  return threadId || undefined;
}

function resolveChoiceValue(action?: SlackAction): string {
  const value = action?.value?.trim();
  if (value) {
    const taggedChoice = parseTaggedChoiceValue(value);
    return taggedChoice?.choice ?? value;
  }

  const actionId = action?.action_id ?? "";
  const taggedAction = parseTaggedChoiceActionId(actionId);
  if (taggedAction) {
    return taggedAction.choice.trim();
  }

  const [, choice = ""] = actionId.split("codex_choice:");
  return choice.trim();
}

function resolveChoicePromptId(action?: SlackAction): number | undefined {
  const value = action?.value?.trim();
  if (value) {
    return parseTaggedChoiceValue(value)?.promptId;
  }

  const actionId = action?.action_id ?? "";
  return parseTaggedChoiceActionId(actionId)?.promptId;
}

function parseTaggedChoiceValue(
  value: string,
): { promptId: number; choice: string } | undefined {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return undefined;
  }

  const promptId = Number.parseInt(value.slice(0, separatorIndex), 10);
  if (!Number.isInteger(promptId) || promptId <= 0) {
    return undefined;
  }

  return {
    promptId,
    choice: value.slice(separatorIndex + 1),
  };
}

function parseTaggedChoiceActionId(
  actionId: string,
): { promptId: number; choice: string } | undefined {
  const prefix = "codex_choice:";
  if (!actionId.startsWith(prefix)) {
    return undefined;
  }

  const taggedValue = actionId.slice(prefix.length);
  const separatorIndex = taggedValue.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= taggedValue.length - 1) {
    return undefined;
  }

  const promptId = Number.parseInt(taggedValue.slice(0, separatorIndex), 10);
  if (!Number.isInteger(promptId) || promptId <= 0) {
    return undefined;
  }

  return {
    promptId,
    choice: decodeChoiceActionComponent(taggedValue.slice(separatorIndex + 1)),
  };
}

function decodeChoiceActionComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseMergeSelection(action?: SlackAction): MergeSelection | undefined {
  const value = action?.value?.trim();
  if (!value) {
    return undefined;
  }

  const promptSeparatorIndex = value.indexOf(":");
  if (promptSeparatorIndex > 0 && promptSeparatorIndex < value.length - 1) {
    const promptId = Number.parseInt(value.slice(0, promptSeparatorIndex), 10);
    if (Number.isInteger(promptId) && promptId > 0) {
      const branchSelection = value.slice(promptSeparatorIndex + 1);
      const branchSeparatorIndex = branchSelection.lastIndexOf(":");
      if (
        branchSeparatorIndex > 0 &&
        branchSeparatorIndex < branchSelection.length - 1
      ) {
        return {
          promptId,
          sourceBranch: branchSelection.slice(0, branchSeparatorIndex),
          targetBranch: branchSelection.slice(branchSeparatorIndex + 1),
        };
      }

      return undefined;
    }
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
