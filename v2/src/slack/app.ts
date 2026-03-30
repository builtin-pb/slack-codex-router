import type { RouterService } from "../router/service.js";
import { registerThreadControlActions } from "../runtime/control_actions.js";

type SlackMessageEvent = {
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  subtype?: string;
};

type SayFn = (message: { text: string; thread_ts: string }) => Promise<unknown>;

type SlackMessageApp = {
  event(
    name: "message",
    listener: (args: { event: SlackMessageEvent; say: SayFn }) => Promise<void>,
  ): void;
  action?: Parameters<typeof registerThreadControlActions>[0]["action"];
};

export function registerSlackMessageHandler(
  app: SlackMessageApp,
  router: RouterService,
  options?: {
    requestProcessExit?(exitCode: number): void;
  },
): void {
  app.event("message", async ({ event, say }) => {
    if (event.subtype) {
      return;
    }

    const threadTs = event.thread_ts ?? event.ts;

    await router.handleSlackMessage({
      channelId: event.channel,
      messageTs: event.ts,
      threadTs,
      text: event.text ?? "",
      userId: event.user ?? "",
      reply: async (message) => {
        await say({
          text: message,
          thread_ts: threadTs,
        });
      },
    });
  });
  if (app.action) {
    registerThreadControlActions({ action: app.action.bind(app) }, router, options);
  }
}
