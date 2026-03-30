import type { RouterConfig } from "../config.js";
import type { RestartIntent, ThreadRecord } from "../domain/types.js";
import { recoverAfterRestart } from "../runtime/restart.js";

type PostMessageInput = {
  channel: string;
  text: string;
  thread_ts: string;
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
  threadStart(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  turnStart(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

type RouterStoreLike = {
  getPendingRestartIntent(): RestartIntent | null;
  listRecoverableThreads(): ThreadRecord[];
  clearRestartIntent(): void;
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
  const detachLineListener = input.appServerProcess.onLine((line) => {
    input.appServerClient.handleLine(line);
  });

  void input.appServerProcess
    .waitForExit()
    .then(() => {
      detachLineListener();
      input.appServerClient.failPendingRequests(new Error("App Server process exited"));
    })
    .catch((error: unknown) => {
      detachLineListener();
      input.appServerClient.failPendingRequests(asError(error));
    });

  await input.appServerClient.initialize();
  input.registerSlackMessageHandler(input.slackApp, input.routerService);
  await input.slackApp.start();

  const recovery = await recoverAfterRestart({
    pendingRestartIntent: input.store.getPendingRestartIntent(),
    recoverableThreads: input.store.listRecoverableThreads(),
  });

  if (recovery.notifyChannelId && recovery.notifyThreadTs) {
    await input.slackApp.client.chat.postMessage({
      channel: recovery.notifyChannelId,
      text: `Router restarted. Recovered ${recovery.recoveredThreadCount} thread mapping(s).`,
      thread_ts: recovery.notifyThreadTs,
    });
    input.store.clearRestartIntent();
  }
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error("App Server process exited");
}
