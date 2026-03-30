import type { AppServerNotification } from "../app_server/events.js";
import type { RouterConfig } from "../config.js";
import type { RestartIntent, ThreadRecord, ThreadState } from "../domain/types.js";
import { recoverAfterRestart } from "../runtime/restart.js";
import { toRouterEventEffect } from "./events.js";
import { withThreadControls } from "../slack/render.js";

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
  upsertThread(record: ThreadRecord): void;
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

  void input.appServerProcess
    .waitForExit()
    .then(() => {
      detachEventListener();
      detachLineListener();
      input.appServerClient.failPendingRequests(new Error("App Server process exited"));
    })
    .catch((error: unknown) => {
      detachEventListener();
      detachLineListener();
      input.appServerClient.failPendingRequests(asError(error));
    });

  await input.appServerClient.initialize();
  input.registerSlackMessageHandler(input.slackApp, input.routerService);
  await input.slackApp.start();

  refreshThreadMap();
  const recovery = await recoverAfterRestart({
    pendingRestartIntent: input.store.getPendingRestartIntent(),
    recoverableThreads: input.store.listRecoverableThreads(),
  });

  for (const recoveredThread of recovery.recoveredThreads) {
    input.store.upsertThread(recoveredThread);
  }
  refreshThreadMap();

  if (recovery.notifyChannelId && recovery.notifyThreadTs) {
    await input.slackApp.client.chat.postMessage({
      channel: recovery.notifyChannelId,
      text: `Router restarted. Recovered ${recovery.recoveredThreadCount} thread mapping(s).`,
      thread_ts: recovery.notifyThreadTs,
    });
    input.store.clearRestartIntent();
  }
}

async function bridgeAppServerNotification(input: {
  notification: AppServerNotification;
  findThreadRecord(threadId: string): ThreadRecord | null;
  persistThread(record: ThreadRecord): void;
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

  if (effect.state) {
    input.persistThread(nextThreadRecord);
  }

  if (!effect.message) {
    return;
  }

  const renderedMessage = withThreadControls(effect.message, nextThreadRecord.state);
  await input.postSlackMessage({
    channel: nextThreadRecord.slackChannelId,
    text: renderedMessage.text,
    thread_ts: nextThreadRecord.slackThreadTs,
    blocks: renderedMessage.blocks,
  });
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
