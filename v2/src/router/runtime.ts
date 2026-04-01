import type { AppServerNotification } from "../app_server/events.js";
import type { RouterConfig } from "../config.js";
import type { RestartIntent, ThreadRecord, ThreadState } from "../domain/types.js";
import { recoverAfterRestart } from "../runtime/restart.js";
import { toRouterEventEffect } from "./events.js";
import {
  withThreadControls,
  type SlackRenderedMessage,
} from "../slack/render.js";

type PostMessageInput = {
  channel: string;
  text: string;
  thread_ts: string;
  blocks?: unknown[];
};

type SlackAppLike = {
  event(name: "message", listener: (...args: unknown[]) => Promise<void>): void;
  start(): Promise<unknown>;
  client: {
    chat: {
      postMessage(message: PostMessageInput): Promise<unknown>;
    };
  };
};

type AppServerProcessLike = {
  writeLine(line: string): void;
  onLine(listener: (line: string) => void): () => void;
  waitForExit(): Promise<number | null>;
};

type AppServerClientLike = {
  initialize(): Promise<void>;
  handleLine(line: string): void;
  failPendingRequests(error: Error): void;
  events: {
    subscribe(listener: (notification: AppServerNotification) => void): () => void;
  };
  threadStart(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  turnStart(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

type RouterStoreLike = {
  getPendingRestartIntent(): RestartIntent | null;
  listRecoverableThreads(): ThreadRecord[];
  clearRestartIntent(): void;
  clearRestartIntentIfMatches?(intent: RestartIntent | null): boolean;
  discardChoicePrompt?(promptId: number): void;
  upsertThread(record: ThreadRecord): void;
  recordChoicePrompt?(input: {
    slackChannelId: string;
    slackThreadTs: string;
    options: string[];
  }): number | null;
};

type RouterServiceLike = object;

export async function startRouterRuntime(input: {
  config: RouterConfig;
  store: RouterStoreLike;
  appServerProcess: AppServerProcessLike;
  appServerClient: AppServerClientLike;
  slackApp: SlackAppLike;
  routerService: RouterServiceLike;
  registerSlackMessageHandler(
    app: SlackAppLike,
    router: RouterServiceLike,
  ): void;
}): Promise<void> {
  const threadsByAppServerThreadId = new Map<string, ThreadRecord>();
  let runtimeClosed = false;
  const refreshThreadMap = (): void => {
    threadsByAppServerThreadId.clear();
    for (const record of input.store.listRecoverableThreads()) {
      threadsByAppServerThreadId.set(record.appServerThreadId, record);
    }
  };
  const findThreadRecord = (threadId: string): ThreadRecord | null => {
    refreshThreadMap();
    return threadsByAppServerThreadId.get(threadId) ?? null;
  };
  const detachEventListener = input.appServerClient.events.subscribe((notification) => {
    bridgeAppServerNotification({
      notification,
      findThreadRecord,
      persistThread(record) {
        threadsByAppServerThreadId.set(record.appServerThreadId, record);
        input.store.upsertThread(record);
      },
      discardChoicePrompt(promptId) {
        input.store.discardChoicePrompt?.(promptId);
      },
      recordChoicePrompt(prompt) {
        return input.store.recordChoicePrompt?.(prompt) ?? null;
      },
      postSlackMessage(message) {
        return input.slackApp.client.chat.postMessage(message);
      },
    }).catch((error: unknown) => {
      console.error("Failed to bridge App Server notification", asError(error));
    });
  });

  const detachLineListener = input.appServerProcess.onLine((line) => {
    input.appServerClient.handleLine(line);
  });

  const closeRuntime = (error?: unknown): void => {
    if (runtimeClosed) {
      return;
    }

    runtimeClosed = true;
    detachEventListener();
    detachLineListener();
    if (error !== undefined) {
      input.appServerClient.failPendingRequests(asError(error));
    }
  };

  void input.appServerProcess
    .waitForExit()
    .then(() => {
      closeRuntime(new Error("App Server process exited"));
    })
    .catch((error: unknown) => {
      closeRuntime(error);
    });

  try {
    await input.appServerClient.initialize();
    input.registerSlackMessageHandler(input.slackApp, input.routerService);
    await input.slackApp.start();

    refreshThreadMap();
    const pendingRestartIntent = input.store.getPendingRestartIntent();
    const recovery = await recoverAfterRestart({
      pendingRestartIntent,
      recoverableThreads: input.store.listRecoverableThreads(),
    });

    for (const recoveredThread of recovery.recoveredThreads) {
      input.store.upsertThread(recoveredThread);
    }
    refreshThreadMap();

    let recoveryNoticeDelivered =
      !recovery.notifyChannelId || !recovery.notifyThreadTs;

    if (recovery.notifyChannelId && recovery.notifyThreadTs) {
      try {
        await input.slackApp.client.chat.postMessage({
          channel: recovery.notifyChannelId,
          text: `Router restarted. Recovered ${recovery.recoveredThreadCount} thread mapping(s).`,
          thread_ts: recovery.notifyThreadTs,
        });
        recoveryNoticeDelivered = true;
      } catch (error: unknown) {
        console.error("Failed to post restart recovery notice", asError(error));
      }
    }

    if (recoveryNoticeDelivered) {
      if (input.store.clearRestartIntentIfMatches?.(pendingRestartIntent) !== true) {
        if (shouldClearRestartIntent(input.store.getPendingRestartIntent(), pendingRestartIntent)) {
          input.store.clearRestartIntent();
        }
      }
    }
  } catch (error) {
    closeRuntime(error);
    throw error;
  }
}

async function bridgeAppServerNotification(input: {
  notification: AppServerNotification;
  findThreadRecord(threadId: string): ThreadRecord | null;
  persistThread(record: ThreadRecord): void;
  discardChoicePrompt?(promptId: number): void;
  recordChoicePrompt?(input: {
    slackChannelId: string;
    slackThreadTs: string;
    options: string[];
  }): number | null;
  postSlackMessage(message: PostMessageInput): Promise<unknown>;
}): Promise<void> {
  const effect = toRouterEventEffect(input.notification);
  if (!effect) {
    return;
  }

  const threadRecord = input.findThreadRecord(effect.threadId);
  if (!threadRecord) {
    return;
  }

  const nextThreadRecord =
    effect.state
      ? {
          ...threadRecord,
          state: effect.state,
          activeTurnId: clearsActiveTurn(effect.state) ? null : threadRecord.activeTurnId ?? null,
        }
      : threadRecord;

  let shouldPersistAfterDelivery = false;
  let pendingChoicePromptId: number | null = null;

  if (
    effect.state === "awaiting_user_input" &&
    effect.choiceOptions &&
    effect.choiceOptions.length > 0
  ) {
    const promptId = input.recordChoicePrompt?.({
      slackChannelId: nextThreadRecord.slackChannelId,
      slackThreadTs: nextThreadRecord.slackThreadTs,
      options: effect.choiceOptions,
    });
    if (promptId && effect.message) {
      pendingChoicePromptId = promptId;
      effect.message = tagChoicePromptInMessage(effect.message, promptId);
      shouldPersistAfterDelivery = true;
    } else if (effect.message) {
      effect.message = stripChoiceButtons(effect.message);
      shouldPersistAfterDelivery = true;
    }
  }

  if (effect.state && !shouldPersistAfterDelivery) {
    input.persistThread(nextThreadRecord);
  }

  if (!effect.message) {
    return;
  }

  const renderedMessage = withThreadControls(
    effect.message,
    nextThreadRecord.state,
    nextThreadRecord.activeTurnId,
    nextThreadRecord.appServerThreadId,
  );
  try {
    await input.postSlackMessage({
      channel: nextThreadRecord.slackChannelId,
      text: renderedMessage.text,
      thread_ts: nextThreadRecord.slackThreadTs,
      blocks: renderedMessage.blocks,
    });
  } catch (error) {
    if (pendingChoicePromptId) {
      input.discardChoicePrompt?.(pendingChoicePromptId);
    }
    throw error;
  }

  if (effect.state && shouldPersistAfterDelivery) {
    input.persistThread(nextThreadRecord);
  }
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error("App Server process exited");
}

function clearsActiveTurn(state: ThreadState): boolean {
  return state === "idle" || state === "interrupted" || state === "failed_setup";
}

function shouldClearRestartIntent(
  currentRestartIntent: RestartIntent | null,
  bootRestartIntent: RestartIntent | null,
): boolean {
  if (!currentRestartIntent || !bootRestartIntent) {
    return false;
  }

  return (
    currentRestartIntent.slackChannelId === bootRestartIntent.slackChannelId &&
    currentRestartIntent.slackThreadTs === bootRestartIntent.slackThreadTs &&
    currentRestartIntent.requestedAt === bootRestartIntent.requestedAt
  );
}

function tagChoicePromptInMessage(
  message: SlackRenderedMessage,
  promptId: number,
): SlackRenderedMessage {
  return {
    ...message,
    blocks: message.blocks?.map((block) => {
      if (!isActionsBlock(block)) {
        return block;
      }

      return {
        ...block,
        elements: block.elements.map((element) => {
          if (!isChoiceButtonElement(element)) {
            return element;
          }

          return {
            ...element,
            action_id: tagChoiceActionId(element.value, promptId),
            value: tagChoiceValue(element.value, promptId),
          };
        }),
      };
    }),
  };
}

function tagChoiceActionId(choiceValue: string, promptId: number): string {
  return `codex_choice:${promptId}:${encodeURIComponent(choiceValue)}`;
}

function tagChoiceValue(value: string, promptId: number): string {
  return `${promptId}:${value}`;
}

function stripChoiceButtons(message: SlackRenderedMessage): SlackRenderedMessage {
  return {
    ...message,
    blocks: message.blocks?.map((block) => {
      if (!isActionsBlock(block)) {
        return block;
      }

      return {
        ...block,
        elements: block.elements.filter((element) => !isChoiceButtonElement(element)),
      };
    }),
  };
}

function isActionsBlock(value: unknown): value is {
  type: "actions";
  elements: unknown[];
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { type?: unknown }).type === "actions" &&
      Array.isArray((value as { elements?: unknown }).elements),
  );
}

function isChoiceButtonElement(value: unknown): value is {
  type: "button";
  action_id: string;
  value: string;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { type?: unknown }).type === "button" &&
      typeof (value as { action_id?: unknown }).action_id === "string" &&
      typeof (value as { value?: unknown }).value === "string" &&
      (value as { action_id: string }).action_id.startsWith("codex_choice:"),
  );
}
